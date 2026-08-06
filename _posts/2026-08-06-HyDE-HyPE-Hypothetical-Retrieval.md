---
layout: post
title: HyDE 与 HyPE —— 假设检索技术的两个方向
date: 2026-08-06 21:00:00 +0800
categories: [RAG]
tags: [rag, hyde, hype, retrieval, query-expansion]
giscus_comments: true
---

# HyDE 与 HyPE —— 假设检索技术的两个方向

## 要解决的问题

普通 RAG 检索时，用户查询是**短问句**，库里存的是**长文档**。两者的向量分布在 embedding 空间里相隔很远 —— 论文里叫 **query-document style mismatch**。短问句直接去匹配长文档，经常匹配不准。

HyDE 和 HyPE 是解决这个「风格鸿沟」的两个方向。核心思路一致：**用 LLM 生成一个「假的东西」，让查询和存储的形态对齐**。但方向恰好相反。

## HyDE：查询时生成假文档

HyDE = Hypothetical Document Embedding（假设文档嵌入）。

**核心**：查询时，先让 LLM 根据问题生成一个**假装已经答好的文档**，再用这个假文档去向量库检索。

```python
class HyDERetriever:
    def __init__(self, files_path, chunk_size=500, chunk_overlap=100):
        self.hyde_prompt = PromptTemplate(
            input_variables=["query", "chunk_size"],
            template="""Given the question '{query}', generate a hypothetical document
            that directly answers this question. The document should be detailed and in-depth.
            the document size has be exactly {chunk_size} characters.""",
        )
        self.hyde_chain = self.hyde_prompt | self.llm

    def retrieve(self, query, k=3):
        hypothetical_doc = self.generate_hypothetical_document(query)  # 先生成假文档
        similar_docs = self.vectorstore.similarity_search(hypothetical_doc, k=k)  # 用假文档检索
        return similar_docs, hypothetical_doc
```

**流程**：

```
用户问题 → LLM 生成假文档(假设的答案) → 用假文档去 FAISS 检索 → 返回真实 chunk
```

关键设定：prompt 里要求假文档长度 `exactly {chunk_size}`，让假文档和库里的 chunk **长度形态一致**，向量更贴近。

- **时机**：查询时（在线）
- **成本**：每次查询都要调 LLM 生成，有额外开销
- **匹配**：文档 ↔ 假文档

## HyPE：入库时生成假问题

HyPE = Hypothetical Prompt Embeddings（假设提示词嵌入）。

**核心**：与 HyDE 反过来 —— 入库时，让 LLM 对每个 chunk **猜几个「用户可能会问的问题」**，把这些问题向量存进库，而不是存 chunk 原文向量。

```python
def generate_hypothetical_prompt_embeddings(chunk_text: str):
    question_chain = question_gen_prompt | llm | StrOutputParser()
    questions = question_chain.invoke({"chunk_text": chunk_text}).replace("\n\n", "\n").split("\n")
    return chunk_text, embedding_model.embed_documents(questions)
```

入库时**一对多**：一个 chunk 生成 N 个问题向量，但都指向同一个 chunk，所以一个 chunk 被存 N 次。

```python
chunks_with_embedding_vectors = [(chunk.page_content, vec) for vec in vectors]
vector_store.add_embeddings(chunks_with_embedding_vectors)
```

**流程**：

```
chunk → LLM 猜N个问题 → 分别embed → N个问题向量(都指向同一chunk) → FAISS
用户查询 → embed → 问题↔问题匹配 → 映射回chunk原文
```

- **时机**：入库时（离线）
- **成本**：一次性，入库多花；查询零额外开销
- **匹配**：问题 ↔ 问题

## 对比

| 维度     | HyDE                 | HyPE                   |
| -------- | -------------------- | ---------------------- |
| 生成时机 | 查询时（在线）       | 入库时（离线）         |
| 生成什么 | 假装好的**答案文档** | 用户会问的**假设问题** |
| 成本位置 | 每次查询都花         | 入库一次性花           |
| 匹配方式 | 文档 ↔ 假文档        | 问题 ↔ 问题            |
| 扩展性   | 查询越忙越贵         | 查询阶段零开销，可扩展 |

## 一句话总结

HyDE 和 HyPE 是**同一个思路的两个方向**：都用 LLM 弥合「用户怎么问」和「文档怎么存」之间的风格鸿沟。

- **HyDE** 把查询变成假文档，改的是**查询侧**。
- **HyPE** 把文档变成假问题，改的是**存储侧**。

HyPE 把成本挪到入库的一次性开销，换来查询时的零额外成本，这是它「可扩展」的最大卖点。HyPE 论文宣称检索精度最高可提升 42 个百分点。

## 参考

- HyPE 预印本：https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5139335
- 仓库：https://github.com/NirDiamant/RAG_Techniques
