---
layout: post
title: RAG 技术体系化分类——从 Pipeline 阶段到失败模式
date: 2026-08-02 17:30:00 +0800
categories: [RAG]
tags: [rag]
---
# RAG 技术体系化分类——从 Pipeline 阶段到失败模式

## 一、核心观点

所有 RAG 技术本质上都在优化同一个目标：

> **在成本、延迟、质量、可控性之间取得平衡，让 LLM 拿到最合适、最相关、最可控的上下文。**

传统的线性流水线可以抽象为：

```
Query → Query处理 → Embedding → 检索 → 重排/压缩 → 上下文组装 → LLM生成
```

不同技术是在这个漏斗的不同位置做优化，但很多先进技术已经**跨层**甚至形成**反馈循环**。

---

## 二、按 Pipeline 阶段分类

### 1. Query 层：查询理解与改写

这些技术不改知识库，只改用户 query 或查询策略：

| 技术                    | 核心做法                               |
| ----------------------- | -------------------------------------- |
| `query_transformations` | query 重写、扩展、消歧                 |
| `HyDe`                  | 让 LLM 生成假设答案/文档，再用它去检索 |
| `HyPE`                  | 生成假设 prompt 增强 query 表示        |
| `memorag`               | 利用历史记忆改写/增强 query            |
| `adaptive_retrieval`    | 对 query 分类后选择不同检索策略        |

**Insight**：这一层优化的不是"检索本身"，而是让 query 更接近索引内容的语义分布。

---

### 2. Encoding / 表示层：文档如何被嵌入

这些技术改变"文档以什么形式进入向量空间"：

| 技术                              | 核心做法                                 |
| --------------------------------- | ---------------------------------------- |
| `semantic_chunking`               | 按语义边界切分                           |
| `proposition_chunking`            | 用 LLM 拆成原子化命题再嵌入              |
| `multi_model_rag_with_captioning` | 图片/表格用 VLM 生成文字摘要后统一嵌入   |
| `multi_model_rag_with_colpali`    | 直接用 ColPali 对页面图像做视觉-语言嵌入 |
| `document_augmentation`           | 给文档片段生成问题，把问题也嵌入         |

**Insight**：
- `proposition_chunking` 做语义粒度精细化，代价是索引膨胀。
- `document_augmentation` 做查询-文档对齐。
- ColPali 是端到端视觉检索，captioning 是间接文本检索。

---

### 3. Indexing / 索引结构层

这些技术改变知识库的组织方式：

| 技术                                                                                        | 核心做法                          |
| ------------------------------------------------------------------------------------------- | --------------------------------- |
| `graph_rag` / `graphrag_with_milvus` / `graph_rag_local_attribution` / `Microsoft_GraphRag` | 抽取实体关系，构建知识图谱        |
| `hierarchical_indices`                                                                      | 构建层级索引                      |
| `raptor`                                                                                    | 递归聚类+摘要，构建树状多层次索引 |
| `contextual_chunk_headers`                                                                  | 给 chunk 加文档上下文头再嵌入     |

**Insight**：GraphRAG 和 RAPTOR 都在解决"全局综合类问题"，前者用图+社区摘要，后者用树状语义聚类。

---

### 4. Retrieval / 检索策略层

这些技术改变"怎么从索引里把内容捞出来"：

| 技术                           | 核心做法                    |
| ------------------------------ | --------------------------- |
| `fusion_retrieval`             | 稠密向量 + 稀疏关键词融合   |
| `dartboard`                    | 相关性 + 多样性选择         |
| `adaptive_retrieval`           | 根据 query 类型动态选择策略 |
| `retrieval_with_feedback_loop` | 根据用户反馈调整文档相关分  |

**Insight**：`dartboard` 解决结果冗余，`fusion_retrieval` 解决向量检索对关键词不敏感的问题。

---

### 5. Post-Retrieval / 上下文组装层

这些技术发生在"捞出候选文档后，送给 LLM 前"：

| 技术                                     | 核心做法                        |
| ---------------------------------------- | ------------------------------- |
| `reranking`                              | 用 cross-encoder 重排           |
| `contextual_compression`                 | 压缩/提取最相关部分             |
| `context_enrichment_window_around_chunk` | 给 chunk 加前后窗口             |
| `relevant_segment_extraction`            | 把离散 chunk 重组成连续 segment |
| `explainable_retrieval`                  | 给检索结果生成相关性解释        |

**Insight**：`context_enrichment_window` 是"小块+周边"，`relevant_segment_extraction` 是"基于相关性拼成大块"，方向不同。

---

### 6. Generation / LLM 交互层

这些技术重点在 LLM 如何消费检索结果：

| 技术                                        | 核心做法                                         |
| ------------------------------------------- | ------------------------------------------------ |
| `simple_rag` / `simple_rag_with_llamaindex` | Baseline                                         |
| `simple_csv_rag` / `json_rag`               | 结构化数据 RAG                                   |
| `local_rag_huggingface_faiss`               | 本地模型 + FAISS                                 |
| `reliable_rag`                              | 相关性过滤 + 幻觉检测 + 来源高亮                 |
| `self_rag`                                  | 动态决定检索、评估检索相关性、评估生成支撑度     |
| `crag`                                      | 评估检索质量，动态选择本地知识/网络搜索/两者结合 |

**Insight**：`self_rag` 和 `crag` 是"检索-生成闭环"，LLM 不再只是最后一步。

---

### 7. 系统级 / Agentic / 反馈层

这些技术跨多个阶段，是整体架构设计：

| 技术                           | 核心做法                                               |
| ------------------------------ | ------------------------------------------------------ |
| `Agentic_RAG`                  | query reformulation + parser + reranker + GLM + LMUnit |
| `adaptive_retrieval`           | query 分类 + 策略路由                                  |
| `retrieval_with_feedback_loop` | 用户反馈 → relevance 调整 → 索引微调                   |
| `self_rag` / `crag`            | 自评估、自纠错                                         |

---

## 三、按失败模式选技术

比阶段分类更实用的是"失败模式"视角：

| 失败模式           | 典型症状         | 对应技术                                                          |
| ------------------ | ---------------- | ----------------------------------------------------------------- |
| Query 表达不充分   | 问题太短/歧义    | query_transformations, HyDe, HyPE, memorag                        |
| 文档切分丢失语义   | 答案跨 chunk     | semantic_chunking, proposition_chunking, contextual_chunk_headers |
| 向量检索漏匹配     | 关键词检索差     | fusion_retrieval, document_augmentation                           |
| 检索结果冗余       | top-k 重复       | dartboard                                                         |
| 缺少全局/关系推理  | 需要跨文档综合   | graph_rag, raptor, hierarchical_indices                           |
| 上下文过长/噪声多  | LLM 被干扰       | contextual_compression, relevant_segment_extraction               |
| 检索质量不可信     | 检索到无关文档   | reranking, reliable_rag, self_rag, crag                           |
| 多模态内容无法检索 | PDF 含图/表      | multi_model_rag_with_captioning, multi_model_rag_with_colpali     |
| 系统不能持续改进   | 同样错误反复出现 | retrieval_with_feedback_loop                                      |
| 生成 hallucination | 答案脱离原文     | reliable_rag, self_rag, crag                                      |

---

## 四、最重要的三个洞察

1. **跨层技术是常态**
   真正有效的方案往往跨多个阶段。例如 RAPTOR 同时改了 indexing（树）和 retrieval（分层），Self-RAG 同时改了 retrieval 和 generation。

2. **代价转移而非消除**
   GraphRAG 把成本从在线移到离线，HyDe 把成本从检索后移到检索前，document_augmentation 用索引膨胀换检索精度。RAG 优化本质上是**成本在时间轴和空间轴上的重新分配**。

3. **优化对象不是"检索质量"，而是"对 LLM 生成的边际贡献"**
   检索到的 chunk 相关性高，不一定对最终答案最有帮助。有时需要多样性、反事实证据或结构化关系。

---
