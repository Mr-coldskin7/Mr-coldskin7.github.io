---
layout: post
title: Reranking with LlamaIndex 学习笔记 —— LLM 与 Cross-Encoder 重排
date: 2026-07-27 20:00:00 +0800
categories: [RAG]
tags: [rag, llm, llamaindex, reranking, cross-encoder]
---

## 一、Reranking 解决什么问题？

向量检索（embedding similarity）只能找到“语义相近”的文档，但不一定能找到“真正对回答 query 有用”的文档。

Reranking 的核心价值：**在向量召回的基础上，用更强的模型再筛一遍，把最相关的文档排到最前面**。

典型流程：

```
用户 query
    ↓
向量检索器召回较多候选文档（如 top 10）
    ↓
Reranker 对候选文档重新打分、排序
    ↓
选出最相关的 top_n（如 top 5）传给 LLM 生成答案
```

## 二、掌握这个概念需要回答的问题

### 1. 向量检索有什么问题，为什么还需要 reranking？

向量相似度只衡量“语义接近”，无法判断：

- 文档是否真的包含答案
- 文档的哪一部分对当前 query 最有用
- 多个相关文档之间的细微差别

Reranking 用更强的模型做“相关性二分类/打分”，弥补向量检索的粗粒度问题。

### 2. Reranker 在 RAG 流程里处于哪个位置？

Reranker 是一个 **postprocessor（后处理器）**：

```
Retriever → Reranker → LLM
```

在 LlamaIndex 中，它通过 `node_postprocessors` 传入 `as_query_engine`。

### 3. `similarity_top_k` 和 `top_n` 分别代表什么？

- `similarity_top_k`：向量检索召回的候选文档数量，比如 10。
- `top_n`：reranker 最终返回的文档数量，比如 5。

通常 `similarity_top_k > top_n`，先多召回一些，再精排筛选。

### 4. LLM-based Reranking 的原理是什么？

把 query 和候选文档通过 prompt 一起传给 LLM，让 LLM 判断每个文档的相关性，再按回答打分或排序。

LlamaIndex 的 `LLMRerank` 内部构造的 prompt 类似：

```text
下面是用户的查询：
{query}

下面是检索到的文档：
1. {doc_1}
2. {doc_2}
...
N. {doc_N}

请判断每个文档对回答查询的相关性，输出最相关的 top_n 个文档编号。
```

然后解析 LLM 的输出，返回重新排序后的节点。

### 5. Cross-Encoder Reranking 的原理是什么？

Cross-encoder 是一个**专门训练来做 query-document 相关性打分**的模型。

它把 query 和 document 拼接成一个输入：

```text
[CLS] what is the capital of france? [SEP] Paris is the capital of France. [SEP]
```

模型直接输出一个相关性分数，分数越高越相关。

### 6. LLM-based 和 Cross-Encoder 的本质区别是什么？

真正区别是：

```
|           | LLM-based Rerank              | Cross-Encoder Rerank       |
| --------- | ----------------------------- | -------------------------- |
| 核心模型  | 通用大语言模型                | 专门训练的相关性模型       |
| 输入方式  | query + docs 通过 prompt 拼接 | query + doc 直接拼接成一对 |
| 判断方式  | 靠 prompt 让 LLM 读后判断     | 模型直接输出相关性分数     |
| 能力      | 强，能做复杂推理和解释        | 弱，只能打分               |
| 成本/延迟 | 高                            | 低                         |
| 稳定性    | 较低，受 prompt 影响          | 较高                       |
```

### 7. Cross-Encoder 为什么比 Bi-Encoder 准？

```
|            | Bi-Encoder（普通向量检索）         | Cross-Encoder（重排）   |
| ---------- | ---------------------------------- | ----------------------- |
| 编码方式   | query 和 doc 分别编码              | query 和 doc 一起编码   |
| token 交互 | 无直接交互，各自变成向量后算相似度 | 在 attention 层直接交互 |
| 速度       | 快，可预计算文档向量               | 慢，每对都要过模型      |
| 准确度     | 较低                               | 更高                    |
```

Cross-encoder 的“cross”指的是**交叉注意力**：query 和 doc 的 token 互相看，能捕捉更细粒度的匹配关系。

### 8. LlamaIndex 里 `node_postprocessors` 怎么工作？

`node_postprocessors` 会在检索完成后、传给 LLM 之前，对节点列表做后处理。Reranker 就是其中一种 postprocessor。

```python
index.as_query_engine(
    similarity_top_k=10,
    node_postprocessors=[
        LLMRerank(top_n=5)
    ],
)
```

### 9. `QueryBundle` 在这里起什么作用？

`QueryBundle` 把 query 字符串和可能的相关元数据打包成一个对象，传给 postprocessor。在自定义重排逻辑时会用到。

### 10. 如果 `similarity_top_k=5, top_n=5`，rerank 还有意义吗？

基本没有意义。Rerank 的前提是“召回多、精选少”。如果召回数量和最终数量一样，reranker 没有筛选空间。

### 11. 示例里 baseline 为什么把 “The capital of France is great.” 排前面，rerank 后为什么换成含 “Paris” 的句子？

Baseline 按 embedding 相似度：query 是 “what is the capital of france?”，前面几个短句和 query 的字面重叠高（都含 “capital of France”）。

Rerank 后，LLM 或 cross-encoder 发现真正回答这个问题的是包含 “Paris” 的句子，所以把后者排到前面。

## 三、存在的隐患与权衡

### 隐患 1：LLM rerank 成本高、延迟大

每对 query-doc 都要调一次 LLM，文档越多越贵。适合高精度、低频次场景。

### 隐患 2：Cross-encoder 有领域适配问题

`ms-marco-MiniLM-L-6-v2` 是在通用搜索数据上训练的。如果你的领域很特殊（如医学、法律），可能需要换领域特定的 cross-encoder。

### 隐患 3：Reranking 不一定总能提升生成质量

如果初始召回的文档本身都不相关，rerank 也救不回来。Rerank 只能“在已有的候选里挑更好的”。

### 隐患 4：LLM rerank 的分数不稳定

同样的 query 和文档，换 prompt 或换 LLM，结果可能不同。

```python
Settings.embed_model
## 四、怎么选择？

| 场景                     | 推荐方案                                        |
| ------------------------ | ----------------------------------------------- |
| 预算充足、追求最高精度   | LLM-based rerank                                |
| 大规模、对延迟敏感       | Cross-encoder rerank                            |
| 领域通用（如搜索、问答） | 现成的 ms-marco cross-encoder                   |
| 领域特殊                 | 微调自己的 cross-encoder                        |
| 生产环境常见组合         | Bi-encoder 召回 + Cross-encoder 重排 + LLM 生成 |

## 五、一句话记忆

> **向量检索负责“召回候选”，reranker 负责“精选答案”；LLM 重排靠通用理解，cross-encoder 靠专业训练。**

`★ Insight ─────────────────────────────────────`
1. **Cross-encoder 的“cross”是交叉注意力**，不是交叉验证。query 和 doc 的 token 互相看，所以比各自编码再算相似度更准。
2. **LLM rerank 的瓶颈不在模型大小，而在“每对 query-doc 都要生成文本”**，文档越多越贵；cross-encoder 虽然也要每对过模型，但模型小得多。
3. **生产里最稳的架构是三段式**：bi-encoder 快速召回 → cross-encoder 精排 → LLM 生成答案。这是性价比最高的组合。
`─────────────────────────────────────────────────`
```
