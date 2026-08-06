---
layout: post
title: Multimodal RAG with Captioning 图像描述型多模态 RAG 总结
date: 2026-07-31 21:00:00 +0800
categories: [RAG]
tags: [rag, multimodal, captioning, vision]
---

## 1. 一句话理解

Multimodal RAG with Captioning 不是直接检索图片，而是**先用多模态模型把图片/表格生成文字描述（caption），再把 caption 和原始文本一起存入向量库做传统文本检索**。

## 2. 核心思想

```text
PDF 页面
    ├──→ 提取文字 ───────────┐
    └──→ 提取图片 ─→ Gemini 生成 caption ─┘
                              ↓
                    统一变成文本块
                              ↓
                    Cohere 嵌入 → Chroma 向量库
                              ↓
                    文本检索 → Cohere LLM 生成答案
```

所有非文本内容都被多模态模型"看懂"后"写成文字"，最终全部走传统文本 RAG 链路。

## 3. 完整流程

### 3.1 PDF 解析

使用 PyMuPDF（fitz）同时提取：

- 每页文字
- 页内所有图片

```python
with fitz.open('attention_is_all_you_need.pdf') as pdf_file:
    for page_number in range(len(pdf_file)):
        page = pdf_file[page_number]
        text = page.get_text().strip()
        # 提取图片并保存
```

### 3.2 图片 Captioning

用 Gemini-1.5-flash 看图并生成适合检索的摘要：

```python
response = model.generate_content([image,
    "You are an assistant tasked with summarizing tables, images and text for retrieval. ..."])
```

例如一张 BLEU 分数表可能被描述为：

```text
Table showing BLEU scores for Transformer base and big models. The base model achieves 27.3 BLEU.
```

### 3.3 统一嵌入和检索

把文字和图片描述统一成 `Document`，一起存入 Chroma：

```python
vectorstore = Chroma.from_documents(
    documents=doc_splits + img_splits,
    embedding=embedding_model,
)
```

### 3.4 问答

检索回文字或 caption，交给 LLM 生成答案：

```python
docs = retriever.invoke(query)
generation = rag_chain.invoke({"documents": docs[0].page_content, "question": query})
```

## 4. 与 ColPali 路线的对比

|              | ColPali 路线                | Captioning 路线           |
| ------------ | --------------------------- | ------------------------- |
| 图片处理方式 | 直接当图像检索              | 先生成文字描述            |
| 检索方式     | 视觉特征 + late interaction | 文本 embedding            |
| 索引内容     | base64 图片 + 视觉特征      | 文字 + 图片描述           |
| 检索粒度     | 整页                        | 文本 chunk / 单个 caption |
| 生成阶段输入 | 原始图片                    | 检索到的文字/caption      |
| 优点         | 保留完整视觉信息            | 复用成熟文本 RAG 链路     |
| 缺点         | 索引大、需要多模态 LLM 读图 | caption 质量决定检索上限  |

## 5. 优缺点

### 优点

1. **复用文本 RAG 基础设施**：不需要特殊多模态向量库；
2. **检索粒度更细**：可以精确到某段文字或某张图片；
3. **索引体积小**：不存原始图片；
4. **生成阶段更简单**：给 LLM 的是文字，无需多模态模型。

### 缺点

1. **Caption 质量是瓶颈**：描述错误会传递到检索和生成；
2. **丢失视觉细节**：复杂图表、布局、颜色信息会被简化；
3. **无法处理纯视觉问题**：如"图中红色曲线代表什么"；
4. **额外 LLM 调用成本**：每张图片都要生成 caption。

## 6. 选型建议

| 场景                         | 推荐方案   |
| ---------------------------- | ---------- |
| 需要复用现有文本 RAG 系统    | Captioning |
| 图片内容可被文字较好描述     | Captioning |
| 需要精确到图表中的某个数值   | 两者皆可   |
| 需要保留布局、颜色、视觉关系 | ColPali    |
| 扫描件/手写/复杂排版为主     | ColPali    |
| 追求实现简单、成本低         | Captioning |

## 7. 实践注意事项

1. **Caption 和原始文本混合检索时**，建议给 caption 加前缀标记，如 `IMAGE_CAPTION: ...`，便于区分来源；
2. **不要只取 top-1**：生产环境建议 `k=3~5`；
3. **Caption 提示词很关键**：要指导模型生成"适合检索"的描述，而不是泛泛而谈。

## 8. 核心 Insight

Captioning 路线的本质是用 LLM 做"有损的多模态→文本转换"：

- 优势是把多模态问题降维成文本问题，复用成熟技术栈；
- 代价是图片信息经过 LLM 压缩后，会丢失原始视觉细节；
- 它不是"真正理解图片"，而是"让图片能被文本检索理解"。

## 9. 相关技术

- [[colpali-multimodal-rag-qa]]：直接基于视觉特征检索页面图像
- [[proposition-chunking-summary]]：把文档拆成原子化事实
- [[query-transformations-summary]]：改写问题提高检索匹配度
