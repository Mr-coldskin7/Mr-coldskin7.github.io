---
layout: post
title: 掌握 ColPali 多模态 RAG 需要回答的 8 个问题
date: 2026-07-30 22:30:00 +0800
categories: [RAG]
tags: [rag, colpali, multimodal, retrieval]
---

## 一句话总结

ColPali 不是传统 RAG 的替代品，而是处理**视觉密集型文档**的专用工具。它把 PDF 页面当作图像直接检索，再由多模态 LLM 读懂返回的页面图像。

## 1. ColPali 是为了解决什么痛点？

传统文本 RAG 处理 PDF 时通常先 OCR 提取文字，但会丢失或破坏：

- 页面布局和视觉结构
- 表格、图表、公式的原始形式
- 手写内容、扫描件、复杂排版

ColPali 让检索器直接"看"PDF 页面图像，绕过 OCR，保留完整的视觉信息。

## 2. ColPali 和普通的 text embedding 模型有什么区别？

|          | text embedding | ColPali                      |
| -------- | -------------- | ---------------------------- |
| 输入     | 文本           | 页面图像 + 文本 query        |
| 输出     | 单个向量       | 多组 token-patch 相似度      |
| 匹配方式 | 余弦相似度     | late interaction（后期交互） |
| 粒度     | 整个文档/段落  | 页面级别                     |
| 优势     | 轻量、成熟     | 保留视觉布局、不依赖 OCR     |

普通 embedding 把 query 和文档各压缩成一个向量；ColPali 保留 query token 和图像 patch 之间的细粒度对应关系。

## 3. 什么是 Late Interaction（后期交互）？

Late Interaction 是 ColBERT 提出的思想，也被 ColPali 继承：

```text
普通双塔模型：
query → [一个向量]    doc → [一个向量]    → 算一次相似度

Late Interaction：
query token1 ─┐
query token2 ─┼→ 分别和 doc 的每个 patch 算相似度
query token3 ─┘
                → 聚合所有 token-patch 相似度得到最终分数
```

好处：能定位到文档中具体哪个区域和 query 相关，比如"左下角的表格"。

## 4. 代码里为什么要把 PDF 页面存成 base64？

因为 ColPali 检索返回的是**最相关页面的索引/id**，而不是页面内容。要让人或多模态 LLM 看到这一页，必须从索引里把原始图像还原出来。

base64 就是原始页面图像的编码形式。入库时 `store_collection_with_index=True` 会把每页图片以 base64 存进索引；检索时用 `base64.b64decode()` 解码回图片。

## 5. ColPali 检索回来的是什么？能直接当答案吗？

检索回来的是**页面图像**（以 base64 编码），不能直接当答案。

需要再经过一步：把解码后的图片传给多模态 LLM（如 Gemini、Qwen-VL），让 LLM 看图并回答问题。

完整链路：

```text
ColPali 负责"找哪一页" → 多模态 LLM 负责"读懂这一页"
```

## 6. ColPali 最适合什么场景？

适合以下文档类型：

- 学术论文（包含公式、图表、架构图）
- 财报/年报（大量表格和可视化）
- 产品说明书/手册（图文混排）
- 扫描件/手写笔记
- 任何 OCR 效果差或版式复杂的文档

如果文档是纯文字且版式简单，传统文本 RAG 更便宜、更成熟。

## 7. ColPali 的主要局限是什么？

1. **检索粒度是页**：无法精确到某一段文字；
2. **索引体积大**：要存图片 base64 和视觉特征；
3. **依赖多模态 LLM**：检索后必须再调一次大模型读图；
4. **不支持跨页推理**：答案分散在多页时需要额外处理；
5. **计算成本高**：视觉编码比文本编码慢且贵。

## 8. 整个 pipeline 里各组件分别负责什么？

| 组件                                                        | 职责                                  |
| ----------------------------------------------------------- | ------------------------------------- |
| `RAGMultiModalModel.from_pretrained("vidore/colpali-v1.2")` | 加载 ColPali 检索模型                 |
| `RAG.index(...)`                                            | 把 PDF 每页建索引，同时存 base64 图片 |
| `RAG.search(query, k=1)`                                    | 用文本 query 检索最相关的页面         |
| `base64.b64decode(...)`                                     | 把检索结果还原成图片字节              |
| `Gemini / Qwen-VL`                                          | 读取图片并生成最终答案                |

## 核心 Insight

掌握 ColPali 的标志是：能清晰地区分三个层次：

1. **检索层**（ColPali）：用视觉特征找页面；
2. **存储层**（base64 + 向量索引）：保存页面图像和特征；
3. **生成层**（多模态 LLM）：读懂返回的图片并回答问题。

ColPali 只负责**找图**，看懂图的是后面的多模态 LLM。

## 相关技术

- [[raptor-summary]]：用主题树组织文档
- [[proposition-chunking-summary]]：把文档拆成原子化事实
- [[query-transformations-summary]]：改写问题提高检索匹配度
