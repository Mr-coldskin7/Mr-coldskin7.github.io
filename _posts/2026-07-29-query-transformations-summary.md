---
layout: post
title: Query Transformations 查询转换技术总结
date: 2026-07-29 22:00:00 +0800
categories: [RAG]
tags: [rag, query-transformation, retrieval]
---

## 1. 什么是 Query Transformations？

Query Transformations 是 RAG 中的一种前置优化技术：在把用户问题送进向量检索器之前，先用 LLM 对问题做一次改写、泛化或拆分，从而召回更相关、更全面的文档。

核心思想：**用户原始 query 不一定最适合做向量检索**。

## 2. 解决了什么问题？

向量检索依赖 query 与文档的语义相似度。如果 query：

- **太短太模糊** → 召回的内容偏离主题；
- **太具体** → 缺少必要的背景 context；
- **涉及多个方面** → 单点检索无法覆盖所有角度。

Query Transformations 通过改变 query 的形式，让检索阶段拿到更好的"搜索入口"。

## 3. 三种具体技术

### 3.1 Query Rewriting（查询重写）

**目的：** 把模糊、简短的问题改得更具体、更详细。

**示例：**

|            | 文本                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始 query | What are the impacts of climate change on the environment?                                                                                                     |
| 重写后     | What are the specific effects of climate change on various ecosystems, including changes in temperature, precipitation patterns, sea levels, and biodiversity? |

**适用场景：** 用户 query 太笼统，需要补充关键词和维度。

### 3.2 Step-back Prompting（退一步提问）

**目的：** 生成一个更宽泛、更通用的 query，用于检索背景知识和上下文。

**示例：**

|                 | 文本                                                       |
| --------------- | ---------------------------------------------------------- |
| 原始 query      | What are the impacts of climate change on the environment? |
| Step-back query | What are the general effects of climate change?            |

**适用场景：** 问题很细节，但需要先理解宏观背景，比如医学、法律、科研领域。

### 3.3 Sub-query Decomposition（子查询分解）

**目的：** 把复杂问题拆成 2–4 个简单子问题，分别检索后再综合。

**示例：**

原始 query：

> What are the impacts of climate change on the environment?

分解后：

1. How does climate change affect biodiversity and ecosystems?
2. What are the impacts of climate change on oceanic conditions and marine life?
3. How does climate change influence weather patterns and extreme weather events?
4. What are the effects of climate change on terrestrial environments, such as forests and deserts?

**适用场景：** 问题涉及多个方面，需要多角度召回信息。

## 4. 代码实现要点

本仓库已迁移到阿里云百炼 DashScope + 通义千问，配置方式：

```python
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate

llm = ChatOpenAI(
    openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
    openai_api_key=os.getenv("DASHSCOPE_API_KEY"),
    temperature=0,
    model_name="qwen-turbo",
    max_tokens=4000
)
```

三种转换的核心代码结构类似，都是 `PromptTemplate | LLM`：

```python
prompt = PromptTemplate(input_variables=["original_query"], template=...)
chain = prompt | llm
response = chain.invoke(original_query)
```

## 5. 如何组合进 RAG 流程？

```text
用户 query
    ├──→ Query Rewriting → 更具体的检索
    ├──→ Step-back Prompting → 更宽泛的背景检索
    └──→ Sub-query Decomposition → 多角度分别检索
                ↓
        合并检索结果 → 生成最终答案
```

实际使用时不必三种都用：

| 问题类型     | 推荐技术                |
| ------------ | ----------------------- |
| 太模糊       | Query Rewriting         |
| 太具体缺背景 | Step-back Prompting     |
| 涉及多方面   | Sub-query Decomposition |

## 6. 注意事项

`Sub-query Decomposition` 的解析逻辑比较脆弱：

```python
sub_queries = [q.strip() for q in response.split('\n')
               if q.strip() and not q.strip().startswith('Sub-queries:')]
```

它假设 LLM 一定按编号列表返回。如果输出格式变化（bullet points、换行、解释文字），解析会出错。生产环境建议用 JSON mode 或 function calling 直接返回结构化数组。

## 7. 一句话总结

> Query Transformations = 在向量检索前用 LLM 做一次"检索意图增强"，让 query 更具体、更宽泛或更分散，从而召回更高质量的上下文。

## 8. 相关技术

- [[raptor-summary]]：解决文档组织方式的问题
- [[contextual-compression-summary]]：解决检索结果中噪声过多的问题
