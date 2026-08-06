---
layout: post
title: Hierarchical Indices 层级索引 —— 先粗后细的两级检索
date: 2026-08-06 21:30:00 +0800
categories: [RAG]
tags: [rag, hierarchical-index, retrieval, summarization]
---
# Hierarchical Indices 层级索引 —— 先粗后细的两级检索

## 要解决的问题

普通 RAG 用的是 **flat index**（扁平索引）：所有 chunk 一股脑塞进向量库，查询时全局相似度搜索。文档大或语料多时，flat 检索有两个问题：

1. **效率低**：每次都要扫全部 chunk。
2. **丢失上下文**：chunk 太小，脱离了它在文档里的位置，可能召回不相关的东西。

Hierarchical Indices 的做法：**建两级索引** —— 先存文档级摘要，再存细节 chunk。检索时「先粗后细」：先扫摘要定位到相关文档，再进到该文档的 chunk 里挖细节。

## 两级索引怎么建

key：**摘要和 chunk 共享 page 元数据**，这是两级能串起来的关键。

```
文档(按页) → 摘要向量库(summary)  ← 存每页摘要
           → chunk向量库(detailed) ← 存每页拆出的细节块
                    │
        两边都带 metadata["page"]  —— 靠页码把两级连起来
```

### ① 生成摘要（异步 + 限流）

用 `load_summarize_chain` 的 `map_reduce` 逐页摘要，配合 asyncio 并发 + 指数退避处理限流：

```python
async def summarize_doc(doc):
    summary_output = await retry_with_exponential_backoff(summary_chain.ainvoke([doc]))
    summary = summary_output['output_text']
    return Document(
        page_content=summary,
        metadata={"source": path, "page": doc.metadata["page"], "summary": True}
    )

# 分批处理，每批5个，避免撞限流
batch_size = 5
for i in range(0, len(documents), batch_size):
    batch_summaries = await asyncio.gather(*[summarize_doc(doc) for doc in batch])
    summaries.extend(batch_summaries)
    await asyncio.sleep(1)   # 批间暂停
```

### ② 生成 chunk 并打标

细节 chunk 用 `RecursiveCharacterTextSplitter` 切，metadata 里标记 `summary: False` 和 `page`：

```python
chunk.metadata.update({
    "chunk_id": i,
    "summary": False,
    "page": int(chunk.metadata.get("page", 0))
})
```

### ③ 两个向量库

```python
summary_vectorstore, detailed_vectorstore = await asyncio.gather(
    create_vectorstore(summaries),
    create_vectorstore(detailed_chunks)
)
```

## 层级检索：先粗后细

```python
def retrieve_hierarchical(query, summary_vectorstore, detailed_vectorstore,
                          k_summaries=3, k_chunks=5):
    # 第一级：扫摘要定位相关文档
    top_summaries = summary_vectorstore.similarity_search(query, k=k_summaries)

    relevant_chunks = []
    for summary in top_summaries:
        # 第二级：只在该摘要对应的页码里挖细节 chunk
        page_number = summary.metadata["page"]
        page_filter = lambda metadata: metadata["page"] == page_number
        page_chunks = detailed_vectorstore.similarity_search(
            query, k=k_chunks, filter=page_filter
        )
        relevant_chunks.extend(page_chunks)

    return relevant_chunks
```

**流程**：
```
用户查询 → 扫夏摘要库 → 找到相关文档(页码) → 限定该页 → 扫chunk库 → 返回细节块
```

关键点：第二级用 `page_filter` **按页码过滤**，只从第一级命中的文档页里取 chunk。这样细节不会跑偏到别的章节。

## 对比 flat index

| 维度 | Flat Index | Hierarchical Index |
|------|-----------|---------------------|
| 索引 | 一层，全 chunk | 两层：摘要 + chunk |
| 首次检索 | 全局扫 chunk | 先扫摘要（数据量小） |
| 上下文 | chunk 孤立 | 摘要提供文档级上下文 |
| 效率 | 大语料慢 | 先粗筛，快 |
| 适用 | 小文档/小语料 | 大文档/大语料 |

## 技术细节亮点

- **持久化**：向量库 `save_local` 存盘，避免每次重算：
  ```python
  summary_store.save_local("../vector_stores/summary_store")
  detailed_store.save_local("../vector_stores/detailed_store")
  ```
- **限流处理**：`retry_with_exponential_backoff` + 分批 + `asyncio.sleep`，是调用外部 LLM 摘要时的工程标配。
- **异步**：用 `asyncio.to_thread` + `asyncio.gather` 并发建两个向量库，I/O 密集场景提速。

## 一句话总结

> Hierarchical Index = **摘要粗筛定位 + 页码过滤细取**。用两级索引换取「效率 + 上下文保真」，适合大文档/大语料，代价是入库时要多跑一遍摘要。

## 参考

- 仓库：https://github.com/NirDiamant/RAG_Techniques
