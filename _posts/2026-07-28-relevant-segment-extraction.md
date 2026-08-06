---
layout: post
title: Relevant Segment Extraction (RSE) 学习笔记 —— 从片段到段落
date: 2026-07-28 21:00:00 +0800
categories: [RAG]
tags: [rag, chunking, rse, retrieval, cohere]
giscus_comments: true
---

## 一、RSE 解决什么问题？

RSE 解决的是：
固定 chunk size 无法满足所有查询需求的问题。
RAG 里 chunk size 是个经典权衡：

- **小 chunk**：检索精度高，适合简单事实性问题。
- **大 chunk**：上下文完整，适合需要理解整段内容的问题。

但真实查询是混合的，有些要一句，有些要一章。

RSE 的核心洞察：**相关 chunk 在原文档中往往是聚集成簇的**。所以我们可以先按小 chunk 检索，再把相邻的相关 chunk 拼接成连续段落，兼顾精度和上下文完整性。

## 二、掌握 RSE 需要回答的问题

### 1. RSE 在 RAG 流程里处于哪个位置？

```
向量检索 →（可选重排）→ RSE → LLM
```

RSE 在检索之后、传给 LLM 之前。它把离散的 chunk 重组成连续的 segment。

### 2. 为什么 chunk 之间不能有重叠？

RSE 靠 `chunk_index` 拼接文本。如果有重叠，拼接时会出现重复内容，破坏段落连续性。所以必须 `chunk_overlap=0`。

### 3. RSE 需要什么样的存储？

需要一个 key-value store，能根据 `doc_id` 和 `chunk_index` 快速取回 chunk 文本。因为最终 segment 里有些 chunk 来自相邻位置，不一定在初始检索结果里。

### 4. `chunk_values` 是怎么算出来的？

三步：

1. **绝对相关性**：用 Cohere reranker 得到 `relevance_score`。
2. **变换分布**：用 beta CDF 把 Cohere 集中在 0 或 1 附近的分数摊开到 0~1 之间。
3. **加入 rank 衰减**：`np.exp(-rank/decay_rate) * absolute_relevance`。

```python
absolute_relevance_value = transform(reranked_similarity_scores[i])
chunk_values[index] = np.exp(-i/decay_rate) * absolute_relevance_value
```

为什么要加 rank 衰减？因为 rank 越靠前，置信度越高；只靠绝对分数可能把高分数但排名靠后的噪声也放进来。

### 5. 为什么要把 relevance_values 减去一个阈值？

```python
relevance_values = [v - irrelevant_chunk_penalty for v in chunk_values]
```

减去 `irrelevant_chunk_penalty`（如 0.2）后：

- 不相关 chunk 的值变成负数。
- 相关 chunk 的值保持正数。

这样 **segment 的价值就等于内部所有 chunk 值之和**，可以把找最优 segment 转化成“最大子数组和”问题。

### 6. RSE 怎么找最优 segment？

它是一个**带约束的最大子数组和问题**：

- 单个 segment 最长 `max_length` 个 chunk。
- 所有 segment 总长不超过 `overall_max_length`。
- segment 价值必须大于 `minimum_value`。
- segment 之间不能重叠。

代码里是暴力搜索 + 启发式剪枝，作者说通常 5~10ms。

### 7. `max_length`、`overall_max_length`、`minimum_value` 各控制什么？

| 参数                       | 作用                                                   |
| -------------------------- | ------------------------------------------------------ |
| `max_length`               | 单个 segment 最多包含多少个 chunk，防止 segment 过长   |
| `overall_max_length`       | 所有 segment 加起来最多多少个 chunk，控制总上下文长度  |
| `minimum_value`            | segment 至少要达到多少价值才算有效，过滤低质量 segment |
| `irrelevant_chunk_penalty` | 把不相关 chunk 的分数压成负数，值越小越倾向长 segment  |

### 8. RSE 对“单 chunk 就能回答”的查询有效吗？

有效。如果没有聚集的相关 chunk，RSE 实际上退化成普通的 top-k 检索，只返回孤立的几个高相关 chunk。

### 9. RSE 为什么能发现被夹在中间的不相关 chunk？

因为 segment value 是 chunk value 的总和。如果一个不相关 chunk 被两个高相关 chunk 夹在中间，它的负值会被周围正值抵消，整个 segment 仍然可能是正分。这样这些“被埋没”的 chunk 也会被包含进来，给 LLM 更完整的上下文。

### 10. RSE 和简单扩大 chunk size 有什么区别？

|        | 大 chunk         | RSE                              |
| ------ | ---------------- | -------------------------------- |
| 粒度   | 固定大小，不灵活 | 动态，按 query 决定 segment 长度 |
| 精度   | 容易包含无关内容 | 只把相关簇拼起来                 |
| 上下文 | 完整但粗糙       | 完整且精确                       |
| 计算   | 简单             | 需要 rerank + 优化               |

### 11. 评估结果说明什么？

KITE 基准测试：RSE 平均 6.73 vs Top-k 4.72，提升 42.6%。

FinanceBench：CCH + RSE 达到 83%，baseline 19%。

说明在需要理解连续段落的任务上（财报、法律文件、学术论文），RSE 能显著提升答案质量。

## 三、关键代码理解

### chunk 切分

```python
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=chunk_size,
    chunk_overlap=0,  # 必须无重叠
    length_function=len
)
```

### 相关性计算

```python
reranked_results = client.rerank(model=model, query=query, documents=chunks)
absolute_relevance_value = transform(reranked_similarity_scores[i])
chunk_values[index] = np.exp(-i/decay_rate) * absolute_relevance_value
```

### 最优 segment 搜索

```python
relevance_values = [v - irrelevant_chunk_penalty for v in chunk_values]
best_segments, scores = get_best_segments(
    relevance_values,
    max_length=20,
    overall_max_length=30,
    minimum_value=0.7
)
```

## 四、隐患与权衡

### 隐患 1：依赖 Cohere Rerank API

这个 notebook 用 Cohere reranker 计算相关性。没有 `CO_API_KEY` 就跑不了。生产里可以换成其他 reranker 或本地模型。

### 隐患 2：暴力搜索的复杂度

`get_best_segments` 是 $O(n^2)$ 的暴力搜索。文档很长、segment 很长时会变慢。作者提到生产级实现可以参考 dsRAG 库。

### 隐患 3：参数敏感

- `irrelevant_chunk_penalty` 太小 → segment 过长，包含噪声。
- `irrelevant_chunk_penalty` 太大 → segment 过短，丢失上下文。
- `minimum_value` 太高 → 可能一个 segment 都找不到。
- `minimum_value` 太低 → 召回太多低质量 segment。

### 隐患 4：只适用于连续文档

RSE 假设相关 chunk 在原文档中连续。对于结构化数据（表格、代码、FAQ）或者跳跃性强的文档，效果可能不好。

### 隐患 5：需要维护 chunk 元数据

必须保存每个 chunk 的 `doc_id` 和 `chunk_index`。如果向量库不支持按这些字段快速查找，需要额外维护 key-value store。

## 五、一句话记忆

> **RSE 不直接回答“哪个 chunk 最相关”，而是回答“哪一段连续的 chunk 最值得送给 LLM”。**

`★ Insight ─────────────────────────────────────`

1. **RSE 的本质是“用检索精度换上下文完整性”**：先用小 chunk 保证检索准，再用 segment 拼接保证上下文连续。
2. **“最大子数组和”是这个算法的灵魂**：把相关性分数减去阈值后，最优 segment 就是和最大的子数组，非常优雅。
3. **RSE 和 reranking 是互补的**：rerank 决定 chunk 之间的相对好坏，RSE 决定 chunk 之间的空间关系。两者结合才能真正解决“找到对的那一段”的问题。
   `─────────────────────────────────────────────────`
