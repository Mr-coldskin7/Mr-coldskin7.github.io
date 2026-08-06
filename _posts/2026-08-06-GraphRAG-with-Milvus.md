---
layout: post
title: Graph RAG with Milvus —— 纯向量库造图的多跳推理
date: 2026-08-06 22:00:00 +0800
categories: [RAG]
tags: [rag, graphrag, milvus, multi-hop, knowledge-graph]
giscus_comments: true
---

# Graph RAG with Milvus —— 纯向量库造图的多跳推理

## 要解决的问题

传统 RAG 在**多跳问题**上翻车：比如「欧拉（Euler）的老师（Johann）的儿子（Daniel）做了哪些贡献？」。

普通相似度检索的原理是「查询和段落的语义贴近」，但答案藏在**隔着两跳的关系**里：

```
Euler ←是学生→ Johann ←是儿子→ Daniel ←贡献→ 流体力学
```

查询和 Daniel 的段落语义上离得很远，naive RAG 直接搜不到。

答案：**Graph RAG** —— 用实体关系连成图，沿着图走多跳。但常见的 GraphRAG（如微软版）要装**图数据库**。这个 notebook 的创新是：**只用向量库（Milvus）就做出图推理**，不装图库。

## 核心思想：不存图，算图

整个系统的灵魂一句话：**把「图」拆成 3 个向量集合，图结构不存，查询时用邻接矩阵现算多跳。**

## 入库：3 个向量集合 + 邻接映射

### 原始数据：段落 + 三元组

```json
{
  "passage": "Jakob Bernoulli (1654–1705): ... 他做了X贡献 ...",
  "triplets": [
    ["Jakob Bernoulli", "was the older brother of", "Johann Bernoulli"],
    ["Jakob Bernoulli", "is known for", "the Bernoulli numbers"]
  ]
}
```

### 拆成 3 类

```python
entities  = []   # 实体：三元组的 subject 和 object
relations = []   # 关系：三元组拼成一句话
passages  = []   # 原文段落

for triplet in triplets:
    entities.append(triplet[0])   # subject
    entities.append(triplet[2])   # object
    relations.append(" ".join(triplet))  # "Jakob Bernoulli was the older brother..."
```

**关键**：关系不是存结构化 (subject, predicate, object)，而是**拼成自然语言句子**再嵌入，这样向量才有语义。

### 建 2 张邻接映射表（这才是「图」）

```python
entityid_2_relationids = defaultdict(list)  # 实体 → 参与哪些关系
relationid_2_passageids = defaultdict(list) # 关系 → 出自哪个段落

entityid_2_relationids[entities.index(triplet[0])].append(relation_id)
entityid_2_relationids[entities.index(triplet[2])].append(relation_id)  # 两端都连
relationid_2_passageids[relation_id].append(passage_id)
```

**图从没作为图存过** —— 就两张 Python dict 记录「实体↔关系」「关系↔段落」谁连着谁。

### 3 个向量集合（Milvus）—— 标准的 embedding 入库

3 个列表各自 embedding 进对应集合，跟普通 RAG 入库没区别：

```python
create_milvus_collection("entity_collection")   # 实体向量
create_milvus_collection("relation_collection") # 关系向量
create_milvus_collection("passage_collection")  # 段落向量

def milvus_insert(collection_name, text_list):
    for row_id in range(0, len(text_list), 512):
        batch_texts = text_list[row_id : row_id + 512]
        batch_embeddings = embedding_model.embed_documents(batch_texts)  # 文本→向量
        batch_data = [{"id": id_, "text": text, "vector": vector} ...]
        milvus_client.insert(collection_name, data=batch_data)

milvus_insert(relation_col_name, relations)  # 关系列表 → relation 向量库
milvus_insert(entity_col_name,   entities)   # 实体列表 → entity 向量库
milvus_insert(passage_col_name,  passages)   # 段落列表 → passage 向量库
```

每条记录 `{id, text, vector}`：`id` = 在列表里的下标，`text` = 原文，`vector` = embedding。

**注意**：向量库是「3 列表分别 embedding」来的，**不是从 dict 转的**。dict 和向量库是两条平行线，都来自同一批 3 列表，dict 只记连接、向量库存向量，靠 **id 对齐**。

## 邻接矩阵：把 dict 变成能算的矩阵

查询前把「实体-关系」dict 转成稀疏矩阵：

```python
entity_relation_adj = np.zeros((len(entities), len(relations)))
entity_relation_adj[entity_id, entityid_2_relationids[entity_id]] = 1
entity_relation_adj = csr_matrix(entity_relation_adj)  # 稀疏省内存
```

`entity_relation_adj[i][j]=1` ⟺ 实体 i 参与了关系 j。

**矩阵乘法 = 图遍历**（核心魔法）：

```python
# 1跳：A @ A.T
entity_adj_1_degree = entity_relation_adj @ entity_relation_adj.T
# N跳：乘 N 次
for _ in range(target_degree - 1):
    entity_adj_target_degree = entity_adj_target_degree @ entity_adj_1_degree.T
```

直觉：`A @ A.T` 里，实体 i 和 k 若连到同一关系 j，乘积为 1 —— 说明 i、k 隔一跳相连。**乘一次 = 扩一跳**。

## 查询：向量召回 → 矩阵展开 → LLM 过滤 → 回段落

### ① 双路向量召回（找「图的入口种子」）

查询进来，两条路并行去向量库搜，各得一个种子：

**路 1：实体路** —— NER 提实体，搜实体库

```python
query_ner_list = ["Euler"]            # NER 从查询里抽出实体名
# query_ner_list = ner(query)         # 实际做法，这里写死省事
query_ner_emb = embedding_model.embed_query("Euler")
entity_search = milvus_client.search(entity_collection, data=query_ner_emb, limit=3)
```

目的：精确定位到查询里**明确提到的实体节点**（如 "Euler"）。

**路 2：关系路** —— 整句查询，搜关系库

```python
query_emb = embedding_model.embed_query("What contribution did the son of Euler's teacher make?")
relation_search = milvus_client.search(relation_collection, data=query_emb, limit=3)
```

目的：整句语义去匹配**意图接近的关系**（如「师生/父子」这类模式）。

**为什么两路都要**：实体是「点」，关系是「线」。多跳问题光有点（Euler）不够，还得有线（谁是谁的老师/儿子）。实体路抓锚点，关系路抓结构，一路漏了另一路补。

> NER = Named Entity Recognition，命名实体识别，从文本里抽出人名/地名/机构名这类专有名词。

### ② 邻接矩阵多跳展开

```python
# 从召回的关系出发，扩出所有邻居关系
for hit_id in 召回的关系:
    expanded_from_relation |= relation_adj_target_degree[hit_id].nonzero()

# 从召回的实体出发，扩出相关的所有关系
for hit_id in 召回的实体:
    expanded_from_entity |= entity_relation_adj_target_degree[hit_id].nonzero()

relation_candidate_ids = expanded_from_relation | expanded_from_entity  # 并集
```

这一步是**图遍历**：拿到种子实体/关系，用矩阵查出它们一跳（或多跳）能连到的所有关系。

### ③ LLM rerank（CoT 挑关系）

候选关系太多，用 LLM 聪明地挑 3 条，带 one-shot 例子 + 思维链：

```python
rerank_res = rerank_chain.invoke({"question": query, "relation_des_str": 候选关系})
```

LLM 理解「欧拉的老师是谁 → 谁是他儿子 → 儿子做了啥」，选中关键关系。

### ④ 映射回段落，生成答案

```python
for relation_id in rerank_relation_ids:
    for passage_id in relationid_2_passageids[relation_id]:  # 靠 dict 找原文
        if passage_id not in final_passages:
            final_passages.append(passages[passage_id])
```

选中关系 → 用 `relationid_2_passageids` 找回段落 → 喂 LLM 生成。

## 完整流程

入库是**两条平行线**：向量线（3列表→embedding→3向量库）和图线（3列表→数id→2张邻接dict），靠 id 对齐，dict 不是向量库的来源。

```
入库: 文本 → 三元组
   ├─ 向量线: 实体/关系/段落 3列表 → 各自embedding → 3个Milvus向量库
   └─ 图线:   同一批3列表 → 数id → 2张邻接dict（只记连接，不产生向量）
                                 │ 查询时 dict 转稀疏邻接矩阵

查询: 查询文本
   ├─ 路1: NER提实体("Euler") → embed → 搜【实体库】 → 种子实体 id
   ├─ 路2: 整句embed → 搜【关系库】 → 种子关系 id
   └─ 两路种子 → 邻接矩阵扩N跳 → 候选关系集
      → LLM CoT rerank 挑3条关键关系
      → 靠 relationid_2_passageids 找回段落 → 生成答案
```

双路召回：实体路（NER 抽名词搜实体库）+ 关系路（整句搜关系库），各提供一个「图的入口种子」。**召回找入口，矩阵做蔓延**，然后 LLM 挑关系、dict 回段落。

## 效果对比

同一个多跳问题，naive RAG 和本方法：

|        | naive RAG               | Graph RAG with Milvus           |
| ------ | ----------------------- | ------------------------------- |
| 召回到 | 欧拉本人、Johann 的段落 | 欧拉 + **Daniel（答案所在段）** |
| 答案   | "I don't know"          | Daniel 贡献流体力学/概率/统计   |

naive RAG 失败原因：查询与 Daniel 段落语义距离远，表面关键词对不上。GraphRAG 靠矩阵展开 + rerank 沿着关系链找到了答案。

## 技术要点

- **只用向量库**做出图推理，省掉图数据库
- **稀疏矩阵**做多跳展开，向量化快、省内存，可扩展到数千实体毫秒级
- **双路召回**（实体 + 关系）提供冗余，一路漏了另一路补
- **LLM CoT rerank** 模拟图的社区过滤，比纯相似度更懂多跳意图

## 一句话总结

> Graph RAG with Milvus = **向量召回找入口 + 邻接矩阵现算多跳 ≈ 图遍历 + LLM rerank 过滤 ≈ 社区**。用「一个向量库」拼出伪图推理，省掉图数据库，代价是这些都得现算。

## 参考

- 仓库：https://github.com/NirDiamant/RAG_Techniques
- Milvus / Zilliz Cloud：https://cloud.zilliz.com
