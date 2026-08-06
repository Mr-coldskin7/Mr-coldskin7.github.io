---
layout: post
title: Proposition Chunking 命题化切分总结
date: 2026-07-30 21:00:00 +0800
categories: [RAG]
tags: [rag, chunking, proposition, retrieval]
---
## 1. 一句话理解

Proposition Chunking 不是简单地改写句子，而是**把文档拆解成原子化、自包含的事实单元**，让每个检索单元只表达一个明确事实，从而提高被相关 query 命中的概率。

## 2. 核心动机

传统 chunking 关注的是"切多大"，Proposition Chunking 关注的是"切多细"。

向量检索的效果很大程度上取决于检索单元的语义纯度：

- 长句/长段落包含多个事实，向量会被稀释；
- 代词和指代让单独句子语义不完整；
- 过渡词、修饰语占用 embedding 空间但不贡献事实。

Proposition Chunking 用 LLM 把文本变成一条条独立事实，解决这些问题。

## 3. 完整流程

```text
原始文档
    ↓
RecursiveCharacterTextSplitter 切 chunk（控制 LLM 输入长度）
    ↓
LLM 把每个 chunk 拆成多个 propositions
    ↓
LLM 对每个 proposition 从 4 个维度打分
    ↓
低于阈值的命题丢弃
    ↓
命题嵌入向量库（FAISS）
    ↓
检索并对比：命题检索 vs 原始 chunk 检索
```

## 4. 什么是好的 Proposition？

好的命题满足：

1. **表达单一事实**：一个命题一个 claim；
2. **自包含**：无需上下文即可理解；
3. **用全称不用代词**：避免 He/It/This 等模糊指代；
4. **包含必要细节**：时间、地点、限定词；
5. **一个主谓关系**：不含复杂从句或连词。

示例：

```text
原文：
Brian Chesky, co-founder of Airbnb, shared his experience of being advised to run the company in a traditional managerial style, which led to poor outcomes. He eventually found success by adopting a different approach, influenced by how Steve Jobs managed Apple.

命题：
- Brian Chesky is a co-founder of Airbnb.
- Brian Chesky was advised to run Airbnb in a traditional managerial style.
- Running Airbnb in a traditional managerial style led to poor outcomes.
- Brian Chesky adopted a different approach to running Airbnb.
- Steve Jobs' management style at Apple influenced Brian Chesky's approach.
```

## 5. 质量检查

每个命题从四个维度 1–10 打分：

- **Accuracy**：是否忠实反映原文；
- **Clarity**：是否无需上下文即可理解；
- **Completeness**：是否包含必要细节；
- **Conciseness**：是否简洁不冗余。

低于阈值（如 7 分）的命题会被丢弃。

## 6. 为什么第一步不直接用句子切分？

用 `。` 切句子确实语义边界清晰，但直接作为 LLM 输入有问题：

| 问题 | 说明 |
|------|------|
| 长句超窗 | 法律/学术文本中一个句子可能几百 token |
| 短句浪费 | 大量短句导致 LLM 调用次数爆炸 |
| 上下文丢失 | 相邻句子的指代关系被切断 |

`RecursiveCharacterTextSplitter` 默认会优先按段落、行、空格切分，只在必要时才切断句子，是在**语义连贯性和 token 预算之间取折中**。

如果想让句子优先不被切断，可以自定义分隔符：

```python
text_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    chunk_size=200,
    chunk_overlap=50,
    separators=["\n\n", "。", "！", "？", "\n", " ", ""]
)
```

## 7. 与原始 Chunk 检索的对比

| 维度 | 命题检索 | 原始 chunk 检索 |
|------|---------|----------------|
| 精确性 | 高 | 中 |
| 简洁性 | 高 | 中 |
| 上下文丰富度 | 低 | 高 |
| 全面性 | 低 | 高 |
| 叙事连贯性 | 中（可能碎片化） | 高 |
| 信息过载 | 低 | 高 |
| 适用场景 | 快速事实查询 | 复杂理解型查询 |

## 8. 成本与收益的权衡

Proposition Chunking 的代价：

- 每个 chunk 都要调用 LLM 生成命题；
- 每个命题都要调用 LLM 打分；
- 索引构建成本高。

收益：

- 在线检索更精确；
- 检索单元直接对应事实；
- 特别适合问答型 RAG。

## 9. 与 Query Rewriting 的关系

- **Query Rewriting**：改的是**问题**，让问题更容易匹配文档；
- **Proposition Chunking**：改的是**文档**，让文档更容易匹配问题。

两者方向相反，目标一致。理想情况下可以组合使用。

## 10. 一句话总结

> Proposition Chunking = 把文档拆成原子化事实，让检索从"匹配文本块"升级为"匹配事实"。

## 11. 相关技术

- [[query-transformations-summary]]：改问题来提高检索匹配度
- [[raptor-summary]]：用主题树组织文档
- [[contextual-compression-summary]]：检索后再压缩噪声
