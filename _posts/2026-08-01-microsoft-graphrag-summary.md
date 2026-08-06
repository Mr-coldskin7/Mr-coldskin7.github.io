---
layout: post
title: Microsoft GraphRAG 基于知识图谱的 RAG 总结
date: 2026-08-01 21:00:00 +0800
categories: [RAG]
tags: [rag, graphrag, knowledge-graph, microsoft]
giscus_comments: true
---

## 1. 一句话理解

Microsoft GraphRAG 是一种把文档先转换成**知识图谱**，再基于图谱中的实体、关系和社区进行检索与回答的 RAG 方案。它擅长处理需要跨文档连接信息、全局综合理解的复杂查询。

## 2. 解决什么痛点？

传统 RAG 把文档切成 chunk 后做向量检索，擅长回答"某段文字说了什么"，但不擅长：

- **连接分散信息**：比如"Elon Musk 创立/收购了哪些公司？它们之间有什么关系？"
- **全局理解**：比如"这篇文章的主题是什么？整体趋势如何？"
- **复杂综合推理**：需要把多个来源的信息拼凑起来

GraphRAG 通过知识图谱把实体和关系显式建模，解决这些问题。

## 3. 索引阶段流程

```text
原始文本
    ↓
Text Chunking（文本切分）
    ↓
Element Extraction（LLM 提取实体和关系）
    ↓
Graph Construction（构建知识图谱）
    ↓
Community Detection（发现社区/簇）
    ↓
Community Summarization（为每个社区生成摘要）
```

### 各步骤说明

| 步骤                        | 作用                                                            |
| --------------------------- | --------------------------------------------------------------- |
| **Chunking**                | 把长文本切分成 manageable 的小块                                |
| **Element Extraction**      | LLM 识别实体（如 Elon Musk、Tesla）和关系（如 founded、CEO of） |
| **Graph Construction**      | 实体作为节点，关系作为边，构建知识图谱                          |
| **Community Detection**     | 用 Leiden 等算法发现紧密相关的节点簇                            |
| **Community Summarization** | 为每个社区生成摘要，供全局搜索使用                              |

## 4. 查询阶段：两种搜索模式

### 4.1 Local Search（局部搜索）

针对**具体实体**的查询，展开该实体的邻居节点和相关概念。

示例：

> "What and how many companies and subsidiaries founded by Elon Musk?"

### 4.2 Global Search（全局搜索）

针对**整体语料**的查询，综合多个社区摘要给出宏观回答。

示例：

> "What are the major accomplishments of Elon Musk?"

## 5. 代码实现要点

这个 notebook 使用 GraphRAG 官方 CLI 工具：

```bash
# 初始化配置
python -m graphrag.index --init --root data/graphrag

# 建索引
python -m graphrag.index --root ./data/graphrag

# 查询
python -m graphrag.query --root ./data/graphrag --method local "query"
```

### 配置

- LLM：`gpt-4o`
- Embedding：`text-embedding-3-large`
- 支持 Azure OpenAI 或 OpenAI

> 注意：按照 `.claude.md`，这个 notebook **没有被迁移到阿里云百炼**，因为它明确依赖 Azure OpenAI/OpenAI。

### 数据源

notebook 用 BeautifulSoup 抓取 Wikipedia 上 Elon Musk 的词条，保存为 `data/elon.md`，再喂给 GraphRAG 建索引。

## 6. 与传统 RAG 的对比

|          | 传统 RAG             | GraphRAG             |
| -------- | -------------------- | -------------------- |
| 检索单元 | 文本 chunk           | 实体、关系、社区     |
| 擅长问题 | "某段文字说了什么"   | "这些实体有什么关系" |
| 索引成本 | 低（embedding 一次） | 高（大量 LLM 调用）  |
| 查询成本 | 低                   | 中到高               |
| 全局理解 | 弱                   | 强                   |
| 可解释性 | 低（黑盒相似度）     | 较高（可追溯关系）   |

## 7. 主要局限

1. **索引成本极高**：每个 chunk 都要调 LLM 提取实体和关系；
2. **对 LLM 质量敏感**：实体关系提取错误会传播到整个图谱；
3. **不适合简单事实查询**：如"BLEU 是多少"用传统 RAG 更快更便宜；
4. **图规模管理**：文档量大时图谱可能很庞大，成本上升。

## 8. 适用场景

- 人物关系网分析
- 企业架构与股权关系
- 医学文献中的疾病-药物-症状关系
- 法律案例中的主体关系
- 任何实体关系密集、需要跨文档综合的语料

## 9. 核心 Insight

GraphRAG 的本质是把"语义检索"升级成"关系检索"：

- 向量 RAG 回答"哪段文字和我的问题语义最像"；
- GraphRAG 回答"哪些实体通过什么关系连接在一起"。

## 10. 与 RAPTOR 的对比

- **RAPTOR**：用树的层级抽象解决"宏观 vs 细节"的问题；
- **GraphRAG**：用图的节点关系解决"连接 vs 综合"的问题。

两者甚至可以结合：先用 GraphRAG 找到相关实体和社区，再在 RAPTOR 树中定位这些实体的详细描述。

## 11. 相关技术

- [[raptor-summary]]：用主题树组织文档
- [[proposition-chunking-summary]]：把文档拆成原子化事实
- [[query-transformations-summary]]：改写问题提高检索匹配度
- [[colpali-multimodal-rag-qa]]：多模态图像检索
