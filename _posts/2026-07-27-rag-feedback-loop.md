---
layout: post
title: RAG with Feedback Loop 学习笔记 —— 从机制到隐患
date: 2026-07-27 20:00:00 +0800
categories: [RAG]
tags: [rag, llm, feedback-loop, retrieval]
giscus_comments: true
---

## 一、这个概念解决什么问题？

传统 RAG 是“一次性”的：查询 → 检索 → 生成 → 结束。问题是：

- 检索错了也无法纠正，下次同样的问题还会犯。
- 不懂用户偏好，无法记住用户觉得好的结果。
- 好回答和坏回答都被遗忘，无法形成累积的知识。

Feedback Loop 的核心价值：**让系统从交互中学习，把用户认可的结果在以后排得更靠前**。

## 二、系统里数据怎么流动？

```
PDF → 文本 → chunks → FAISS vectorstore
                              ↓
用户 query → retriever 取回 top-k 文档 → LLM 生成 response
                              ↓
用户打分 (relevance, quality, comments) → 写入 feedback_data.json
                              ↓
下次查询时：
  1. 再次检索文档
  2. LLM 判断历史反馈与“当前 query + 当前文档”是否相关
  3. 把相关反馈的 relevance 平均分映射成乘数，调整 doc.metadata['relevance_score']
  4. 按调整后的分数重新排序，取 top-k 给 LLM
                              ↓
定期（或累积足够多后）：
  把 relevance≥4 且 quality≥4 的 query+response 当成新文本，重建 vectorstore
```

## 三、掌握这个概念需要回答的问题

### 1. `adjust_relevance_scores` 调的是什么？

它**没有修改 FAISS 向量索引**，只调了每个 `Document` 对象上的 `metadata['relevance_score']`。

初始值：

```python
chunk.metadata['relevance_score'] = 1.0
```

调整公式：

```python
doc.metadata['relevance_score'] *= (avg_relevance / 3)
```

- `avg_relevance = 3`（中性）→ 分数不变
- `avg_relevance > 3`（正面）→ 分数变大，排名上升
- `avg_relevance < 3`（负面）→ 分数变小，排名下降

它影响的是：**FAISS 召回后、传给 LLM 前的重新排序**。

### 2. `adjust_relevance_scores` 和 `fine_tune_index` 有什么区别？

```
|          | `adjust_relevance_scores`    | `fine_tune_index`            |
| -------- | ---------------------------- | ---------------------------- |
| 作用时机 | 每次查询                     | 周期性批量执行               |
| 作用对象 | 当前召回文档的 metadata 分数 | 整个 vectorstore             |
| 持久性   | 临时，只对本次排序生效       | 持久，生成新索引             |
| 机制     | 乘性调整 relevance_score     | 把高质量 QA 重新编码进向量库 |
| 代价     | 每次查询都要调 LLM           | 需要重新编码，计算量大       |
```

简单说：**调分是“软调整”，重索引是“硬写入”**。

### 3. 这是“融合检索”吗？

**不是典型的 fusion retrieval**。典型融合检索会组合多个检索器（向量 + BM25 + 关键词等），而这个 notebook 只有一种检索器（FAISS）。

它只是在召回后叠加了一层反馈加权重新排序，更准确的说法是 **feedback-based re-ranking**。

## 四、存在的隐患

### 隐患 1：负面反馈会“污染”后续上下文

负面反馈会降低文档的 `relevance_score`。如果该文档后续又被 FAISS 召回，且 LLM 判定旧反馈与新查询相关，它的分数会再次被压低，甚至可能掉出 top-k，从而**不再进入 LLM 的上下文**。

关键问题：

- 降低的不是 FAISS 向量相似度，而是召回后的加权排序分数。
- 每次都要重新判断旧反馈是否相关，LLM 判断错误时就会“张冠李戴”。

### 隐患 2：“张冠李戴”——旧反馈被误用到新查询

判断相关性的 prompt 类似：

```text
Current query: 巴黎气候协定是什么？
Feedback query: 温室效应是什么？
Document content: The Paris Agreement is...
Feedback response: 温室效应是指大气中的温室气体...

Is this feedback relevant?
```

LLM 可能仅因为两者都含“气候”就判定相关，于是把关于“温室效应”的负面反馈应用到“巴黎气候协定”文档上。

**本质原因**：反馈没有绑定原始检索上下文（原始 query + 原始检索出的文档），相关性归因不准确。

### 隐患 3：`result == 'yes'` 大小写 bug

```python
if result == 'yes':
```

LLM 可能输出 `"Yes"`，条件不成立，反馈被丢弃。应改为：

```python
if result.lower() == 'yes':
```

### 隐患 4：没有遗忘机制

所有反馈永久累积。早期、过时或被误判的反馈会持续影响后续排序，可能让系统越来越偏。

### 隐患 5：反馈文件越大，查询越慢

当前实现每次查询都要对每条反馈 × 每个文档调用 LLM 判断相关性，代价很高。

## 五、优化方向

### 5.1 加速相关性判断

- 缓存相关性判断结果。
- 先用 embedding/关键词粗筛，再让 LLM 精判。
- 只保留最近 N 条或高质量反馈。
- 用轻量 cross-encoder（如 BGE）替代 LLM 做二分类。

### 5.2 改进反馈存储结构

当前是 JSON Lines 追加。更好的方式是 SQLite，并记录原始检索上下文：

```python
{
    "query": "...",
    "response": "...",
    "relevance": 5,
    "quality": 5,
    "retrieved_doc_ids": ["doc_001", "doc_002"],
    "timestamp": "2026-07-27T10:00:00"
}
```

### 5.3 处理多用户矛盾反馈

- 按用户分组，做个性化反馈。
- 加权平均，近期/高信誉用户权重更高。
- 同一文档多条反馈时取多数表决。

### 5.4 引入遗忘机制

- 只保留最近 N 条反馈。
- 对旧反馈逐步衰减权重。
- 定期人工清理或重新标注。

## 六、评估与监控

### 怎么判断反馈回环有效？

- A/B 测试：一半查询走反馈回环，一半不走。
- NDCG / MRR：看相关文档是否更靠前。
- 重复查询胜率：同类问题多次查询是否稳定变好。
- 负面反馈率是否下降。
- 人工抽检 top-k 文档质量。

### 上线后监控什么？

```
| 指标             | 原因                                          |
| ---------------- | --------------------------------------------- |
| 检索延迟         | `adjust_relevance_scores` 每次调 LLM 可能暴涨 |
| 反馈分布         | relevance/quality 的均值与方差                |
| 分数漂移         | `relevance_score` 是否被少数反馈主导          |
| 索引重建耗时     | `fine_tune_index` 是批量重编码                |
| 相关性判断准确率 | 人工抽检 LLM 的 Yes/No 是否正确               |
```

## 七、一句话记忆

> **FAISS 负责“找得到”，`adjust_relevance_scores` 负责“挑得好”，`fine_tune_index` 负责“记得牢”。但“挑得好”的前提是反馈归因要准，否则负面反馈会污染上下文。**
