---
layout: post
title: MemoRAG 记忆增强型 RAG 总结
date: 2026-08-02 17:00:00 +0800
categories: [RAG]
tags: [rag, memorag, memory, query-rewriting]
---
## 1. 一句话理解

MemoRAG 在标准 RAG 的检索阶段之前，增加了一个**记忆模型**。这个模型先对文档库做一次压缩记忆，查询时基于记忆生成更精确的检索线索，从而提高模糊、隐式、长上下文查询的检索质量。

## 2. 解决什么痛点？

标准 RAG 直接对 query 做向量检索，遇到以下情况效果不好：

- query 有歧义或指代（如"那件事后来怎么样了？"）
- query 需要结合文档背景才能理解
- 长文档中信息分散，需要全局上下文
- 用户问题与文档答案在字面上不匹配

MemoRAG 通过记忆模型让检索器"提前知道文档里有什么"。

## 3. 与 Query Transformation 的关系

|                  | Query Transformation | MemoRAG             |
| ---------------- | -------------------- | ------------------- |
| 输入             | 只有 query           | query + 文档记忆    |
| 输出             | 一个改写后的 query   | 多个检索线索/子问题 |
| 是否依赖文档内容 | 否                   | 是                  |
| 成本             | 低                   | 较高（需先建记忆）  |

可以把 MemoRAG 理解为"带全局上下文的 Query Rewriting"。

## 4. 核心流程

```text
文档
    ↓
切分成 chunks
    ↓
Memory Model 抽取/压缩记忆
    ↓
记忆存入向量库
    ↓

用户 query
    ↓
在记忆中检索相关主题
    ↓
生成 text spans + surrogate queries
    ↓
用这些线索检索原始文档
    ↓
LLM 生成最终答案
```

## 5. 本 notebook 中的简化实现

### 5.1 记忆结构：topic-details pairs

用 LLM 从每个文档 chunk 中提取结构化键值对：

```json
{
    "pairs": [
        {"topic": "气候变暖对生物多样性的影响", "details": "气温上升导致许多物种因栖息地丧失而面临灭绝。"},
        {"topic": "海洋酸化", "details": "海洋吸收过量二氧化碳，导致酸化加剧。"}
    ]
}
```

### 5.2 建记忆

```python
def memorize(self, document: str):
    response = client.chat.completions.create(
        model="qwen-turbo",
        messages=[...],
        response_format={"type": "json_object"}
    )
    pairs = self._parse_into_pairs(response)
    # 存入 FAISS
```

### 5.3 查询时生成检索线索

```python
def create_retrieval_queries(self, query: str):
    # 1. 在 memory store 中检索相关 topic-details
    results = self.store.similarity_search_with_score(query, k=10)
    
    # 2. 生成 text spans（关键词/片段线索）
    # 3. 生成 surrogate queries（替代/子问题）
    
    return text_spans + surrogate_queries + [query]
```

## 6. Memory Model 一般是什么？

| 类型           | 例子                               | 特点                           |
| -------------- | ---------------------------------- | ------------------------------ |
| 长上下文 LLM   | Qwen2-7B、Mistral-7B               | 直接读完整数据库，生成压缩记忆 |
| 轻量级专用模型 | memorag-qwen2-7b-inst              | 针对记忆任务微调               |
| 结构化记忆库   | 本 notebook 的 FAISS topic-details | 工程简化版，更易部署           |
| kv-cache 压缩  | 原始论文方案                       | 把长文档压缩成 key-value 表示  |

## 7. 成本分析

| 技术     | 索引阶段 LLM 调用 | 查询阶段额外开销    |
| -------- | ----------------- | ------------------- |
| 标准 RAG | 0                 | 无                  |
| MemoRAG  | 每个 chunk 1 次   | 记忆检索 + 生成线索 |
| GraphRAG | 每个 chunk 多次   | 图展开/社区综合     |

MemoRAG 比 GraphRAG 便宜，但比标准 RAG 贵。适合查询频繁、需要更好检索质量的场景。

## 8. 优缺点

### 优点

1. 提高模糊/隐式查询的检索效果；
2. 复用标准 RAG 检索链路；
3. 实现比 GraphRAG 简单；
4. 适合长文档和对话式 RAG。

### 缺点

1. 索引阶段需要额外 LLM 调用；
2. 记忆质量依赖 LLM 抽取能力；
3. topic 粒度需要调优；
4. 不是真正的跨文档推理，只是增强检索线索。

## 9. 实践注意事项

1. **文档一定要切分后再 memorize**，不要整篇传入；
2. **OpenAI 兼容接口必须设置 `base_url`**，否则默认连 OpenAI 官方；
3. **chunk size 建议 2000-4000 token**，太小会导致 topic 太碎，太大会超时；
4. **给 memory model 设置 timeout 和 retry**，长文本生成可能较慢。

## 10. 核心 Insight

MemoRAG 的核心价值不是"改写问题"，而是"让检索拥有全局上下文"：

- 普通 Query Rewriting：把用户的话翻得更清楚；
- MemoRAG：像读过整本书的助手，不仅翻译问题，还告诉你要查哪几个关键词。

## 11. 相关技术

- [[query-transformations-summary]]：不带记忆的 query 改写
- [[raptor-summary]]：用主题树组织文档
- [[microsoft-graphrag-summary]]：用知识图谱组织文档
- [[proposition-chunking-summary]]：把文档拆成原子化事实
