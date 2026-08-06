---
layout: post
title: RAPTOR 技术总结
date: 2026-07-29 21:30:00 +0800
categories: [RAG]
tags: [rag, raptor, retrieval, summarization]
giscus_comments: true
---

## 1. RAPTOR 是什么？

RAPTOR（Recursive Abstractive Processing and Thematic Organization for Retrieval）是一种面向长文档集合的高级检索增强生成技术。它通过**自底向上构建摘要树**，把原始文本按语义主题逐层聚类、摘要，形成多个抽象层级，从而在回答查询时既能把握宏观主题，也能下钻到具体细节。

## 2. 解决了什么痛点？

传统 RAG 面对大量文档时常常面临两难：

- 只检索原始小块：容易丢失全局上下文。
- 检索高层摘要：又可能遗漏关键细节。

RAPTOR 的思路是：**把文档组织成一棵树**，高层节点代表主题摘要，底层节点保留原始文本。查询时先在高处定位主题，再向下取细节。

## 3. 核心组件

| 组件                    | 作用                                         |
| ----------------------- | -------------------------------------------- |
| 树构建（Tree Building） | 递归地嵌入、聚类、摘要，生成多层节点         |
| 嵌入与聚类              | 用向量相似度把语义相近的文本分到同一组       |
| 向量存储                | 把所有层级的节点一起存入 FAISS，支持快速检索 |
| 上下文检索器            | 从树中召回与查询最相关的节点                 |
| 答案生成                | 基于召回上下文生成最终回答                   |

## 4. 树的构建流程

```text
原始文本（Level 0）
    ↓
Embedding → 聚类（GMM）
    ↓
每类生成摘要 → Level 1
    ↓
重复 Embedding / 聚类 / 摘要 → Level 2 ...
    ↓
直到只剩一个根摘要，或达到 max_levels
```

关键函数 `build_raptor_tree` 的循环逻辑：

1. 对当前层文本做 `embed_texts`。
2. 用高斯混合模型 `GaussianMixture` 聚类，簇数取 `min(10, len(current_texts) // 2)`。
3. 把当前层结果存入 `results[level-1]`。
4. 对每个簇调用 `summarize_texts`，生成下一层节点。
5. 更新 `current_texts` 和 `current_metadata`，继续下一轮。

元数据中会记录 `level`、`origin`、`id`、`child_ids`，用于后续父子导航。

## 5. 检索策略

RAPTOR 示例里实现了两种检索方式：

### 5.1 树遍历检索

从最高层开始，用向量相似度找到 Top-k 相关摘要，然后递归地沿着 `child_ids` 下钻到下一层，直到 Level 0。优点是路径清晰，能严格沿主题下钻。

### 5.2 分层检索 + 上下文压缩

对每一层分别检索，并把命中节点的子节点 ID 拼接到查询条件中；同时用 `ContextualCompressionRetriever` 让 LLM 只保留与问题相关的句子。优点是能跨层收集信息，并压缩噪声。

## 6. 上下文压缩是不是多余的？

不是。它可以理解为“先粗筛、再精读”：

- 向量检索负责快速缩小范围，但返回的是整块内容。
- LLM 压缩负责从整块内容中精确挑出相关句子。

在 RAPTOR 里，上层摘要节点覆盖的主题范围往往比问题更宽，压缩能有效减少最终上下文里的噪声。代价是多一次 LLM 调用，属于可选项而非必选项。

## 7. 本项目中的适配

仓库已统一从 OpenAI 迁移到 **阿里云百炼 DashScope + 通义千问**，`raptor.ipynb` 中的关键配置：

```python
embeddings = OpenAIEmbeddings(
    model="text-embedding-v3",
    openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
    openai_api_key=os.getenv("DASHSCOPE_API_KEY"),
    check_embedding_ctx_length=False,
    chunk_size=10,
)

llm = ChatOpenAI(
    openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
    openai_api_key=os.getenv("DASHSCOPE_API_KEY"),
    model_name="qwen-turbo"
)
```

数据路径统一使用：

```
/Users/lishanyi/Documents/projects/RAG_Techniques/data
```

## 8. 使用建议

- **max_levels**：一般 2–4 层足够，文档越多、主题越复杂可以适当加深。
- **聚类数**：示例用启发式 `min(10, n//2)`，生产环境建议用轮廓系数或业务语义评估。
- **摘要长度**：太短会丢失关键信息，太长则失去压缩意义，需人工抽查迭代。
- **是否启用压缩**：长摘要/长文档值得用；短且精准的 chunk 可以直接喂给生成模型。

## 9. 一句话总结

> RAPTOR = 用聚类+摘要把文档递归压缩成主题树，检索时从高层主题下钻到底层原文，兼顾宏观理解与细节精确。
