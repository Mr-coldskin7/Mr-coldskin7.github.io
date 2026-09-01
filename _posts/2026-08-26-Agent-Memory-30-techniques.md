---
layout: post
title: Agent Memory 全景：30 个记忆技术的模块化拆解
date: 2026-08-26 22:00:00 +0800
categories: [Agent, Memory]
tags: [agent, memory, rag, llm, vector-store, knowledge-graph, retrieval, consolidation, evaluation]
giscus_comments: true
---

# Agent Memory 全景：30 个记忆技术的模块化拆解

> 基于 [NirDiamant/Agent_Memory_Techniques](https://github.com/NirDiamant/Agent_Memory_Techniques) 的 30 个 notebook 整理。这是一篇「地图式」笔记——不求复述每个 notebook 的代码，只求把 30 个技术收敛成几条底层逻辑，以及它们各自的**运作机制、公式和失败模式**。

## 一句话理解

**Agent Memory = 分层存储 + 生命周期维护 + 混合检索。** 30 个技术全是这三件事的变体。如果只记住一句话，记住上面这句。

---

## 总纲：30 个技术回答 5 个问题

```
存进去 ← 找回来 ← 维护 ← 组织 ← 评测
 (01-10)   (20)    (14-19)  (12/13)  (28/29)
```

| 模块 | 编号 | 回答的问题 |
|---|---|---|
| 短期记忆（上下文管理） | 01–05 | 对话越来越长，token 装不下怎么办？ |
| 长期记忆（知识化） | 06–10 | 跨会话，怎么记住「关于世界的事实」？ |
| 检索 | 20（+06、17） | 存了几百万条，怎么快速找到对的那条？ |
| 分层架构 | 12、13、26 | 记忆多了，怎么组织才不糊？ |
| 生命周期维护 | 14、15、18、19 | 记忆重复、冲突、过时、爆炸怎么办？ |
| 学习与进化 | 11、16 | 怎么让 agent 越用越好？ |
| 多会话 / 多 agent | 21、22、23 | 怎么跨会话、跨 agent 共享记忆？ |
| 生产框架 | 24–27 | 别自己造轮子的成品有哪些？ |
| 评测 | 28、29 | 怎么量化记忆系统好不好？ |
| 生产工程 | 30 | 上生产还缺什么？ |

---

## 模块 1 · 短期记忆：上下文装不下怎么办（01–05）

核心问题：对话变长，token 爆了。五个技术是同一个问题的五种权衡——**在「保真」和「成本」之间找分割点**。

| # | 技术 | 本质 | 取舍 |
|---|---|---|---|
| 01 | Conversation Buffer | 全量存，每轮重发 | 零损失，但 token 线性增长、累计成本二次上升 |
| 02 | Sliding Window | 只留最后 K 条，FIFO 淘汰 | 有界成本，但硬遗忘、无优雅降级 |
| 03 | Summary | 历史压成滚动摘要 | 省 token，但 lossy |
| 04 | **Summary Buffer** | 近期原样 + 远期摘要 | **工业标准答案** |
| 05 | Token Buffer | 按 token 预算精确裁剪 | 需要匹配的 tokenizer |

**记住**：04（Summary Buffer）是标准解——最近 K 条消息逐字保留，更早的折进一个滚动摘要。TencentDB Agent Memory 的「符号化短时记忆」就是这个思想，只是把文字摘要换成了 Mermaid 符号画布。

---

## 模块 2 · 长期记忆：对话怎么变知识（06–10）

核心问题：跨会话，怎么记住「关于世界的事实」？这块最基础、也最容易搞混的是 **Episodic 和 Semantic 的区分**。

| # | 技术 | 本质 |
|---|---|---|
| 06 | Vector Store | embed 成向量，按语义召回（基础设施） |
| 07 | Entity | 抽命名实体，维护每实体的 facts（像通讯录） |
| 08 | Knowledge Graph | 抽 (主,谓,宾) 三元组建图，支持多跳推理 |
| 09 | Episodic | 存「整段经历」带时间戳 |
| 10 | Semantic | 抽「无时间戳的永恒事实」+ 去重 + 矛盾检测 |

### Episodic（09）：存「整段经历」

- **数据模型**：一个 episode = `{messages, 起止时间戳, summary, topic tags, embedding}`。存的是原始消息 + 摘要，不是抽出来的事实。
- **边界检测**：决定一个 episode 在哪结束——会话式（显式 `end_session()`）、话题式（LLM 检测话题漂移）、时间式（固定时长）。
- **定稿**：LLM 生成摘要 + 抽 topic tags + 对摘要算 embedding。摘要用于快速检索，原文用于下钻。
- **检索**：综合分 = `α·语义相似度 + β·时间新鲜度`。把「意思相近」和「最近发生」两个信号融合。

Episodic 回答的是 **"what happened when"**，适合审计、debug、"上次我们怎么做的"这类问题。失败模式：边界切太粗 → 一个 episode 塞进三个话题；切太细 → 一个任务碎成五段。

### Semantic（10）：抽「无时间戳的永恒事实」

- **事实抽取**：LLM 扫消息，抽陈述性事实。"我上个月换 Mac 了" → `User uses macOS`。**主动扔掉「何时说的」**，只要事实本身。
- **去重判定（硬阈值）**：cosine **> 0.85** 判重复 → 不新增，给旧事实 confidence +1；**0.5~0.85** 之间 → 调 LLM 判断同义还是矛盾；**< 0.5** → 新事实入库。
- **矛盾处理**：新事实与旧事实冲突时，归档旧的、存新的（以新为准）。
- **置信度**：每条事实带 confidence，反复提到加分。

Semantic 回答的是 **"what do I know"**，适合紧凑召回、用户画像。失败模式：LLM 把「观点」当「事实」抽进来；没有时间衰减时旧事实永远占坑。

### 两者的关系

> **Episodic 存「经历」，Semantic 存「结论」。** 生产系统永远双轨并用：episode 保证据，semantic 保判断。二者加上 14（consolidation）就构成「episodic 捕获 → semantic 提取 → 周期性巩固」的三层栈，这是绝大多数生产记忆系统的骨架。

---

## 模块 3 · 检索管线（20）：怎么把对的记忆找回来

这是全库最技术的一块。核心结论：**纯向量检索不够，生产系统用多级混合管线**。

```
query → ①embedding(语义) ─┐
       → ②BM25(关键词)  ──┼→ ③RRF 融合 → ④cross-encoder 重排 → ⑤MMR 去冗余 → 结果
                                           ↑
                                  ⑥HyDE(查询改写)
```

### ① Embedding（语义检索）

把 query 和每条记忆都变成向量，算余弦相似度：

```
cos(θ) = (A·B) / (||A||·||B||)
```

强在**跨越用词差异**——「怎么调试登录超时」和「auth 接口 600 秒报错」向量很近，即使一个词都不重复。弱在**不认词**：专业术语、人名、API 名这些低频但关键的词，embedding 模型可能没学过，导致漏召回。

### ② BM25（关键词检索）

经典的词频-逆文档频率模型：

```
score(q,d) = Σ IDF(t) · (f(t,d)·(k1+1)) / (f(t,d) + k1·(1−b+b·|d|/avgdl))
```

- `IDF(t)`：词越稀有，权重越高。
- `f(t,d)`：词在文档里的出现频率。

强在**精确词匹配**（模型名、函数名、大小写敏感的词一击即中），弱在**不懂同义**（"登录" 和 "login" 是两个字面）。

### ③ RRF 融合（Reciprocal Rank Fusion）

把 ① 和 ② 的**排名**合并，而不是合并分数（两者分数量纲不同，不能直接加）：

```
RRF_score(d) = Σ 1/(k + rank_r(d))    # k 通常取 60
```

**为什么用排名不用分数**：向量相似度是 0.9，BM25 是 4.7，直接相加无意义。排名是无量纲的，可以跨方法相加。这就是 TencentDB 配置里 `recall.strategy: "hybrid"` 的底层实现。

### ④ Cross-encoder 重排

关键在于 **bi-encoder vs cross-encoder**：

| | bi-encoder（①②） | cross-encoder（④） |
|---|---|---|
| 怎么做 | query 和 doc **分开**各自 embed，再算相似度 | query 和 doc **拼在一起**喂进模型，直接输出相关分 |
| 速度 | 快（向量可预存） | 慢（每对都要过模型，50–200ms） |
| 精度 | 粗 | 准 |

所以管线是两段式：①②③ 用便宜的 bi-encoder 从百万条里粗筛 top-20，④ 再用贵的 cross-encoder 精排这 20 条。**「粗筛 + 精排」**，和 Milvus GraphRAG 里的 CoT rerank 同一个思想。

### ⑤ MMR 去冗余（Maximal Marginal Relevance）

解决「top-10 全是同一个意思的重复」：

```
MMR = argmax [ λ·Sim(q,d) − (1−λ)·max_{d'∈已选} Sim(d,d') ]
```

第一项要相关，第二项惩罚与已选结果的重复，`λ` 控制平衡（通常 0.5~0.7）。避免 token 浪费在冗余上。

### ⑥ HyDE（查询改写）

解决「短 query vs 长记忆」的词表鸿沟：先让 LLM 生成一篇**假设答案**，再用这篇假设答案去 embed 和检索——长文本对长文本，相似度算得更准。核心洞察：用一个「不保证正确但语义对」的假设答案，代替真实 query 做向量匹配。

**实践建议**：最小可行是 **①+②+③（hybrid）**，④⑤⑥ 是进阶。跨编码器重排要额外的模型部署成本，别一上来全上。

---

## 模块 4 · 分层架构：记忆怎么组织（12、13、26）

核心问题：记忆多了，怎么不糊成一团。

| # | 技术 | 本质 |
|---|---|---|
| 12 | Working Memory | 上下文内的「注意力管理」：salience 打分 + **pin 固定** + 动态淘汰（不是 FIFO） |
| 13 | Hierarchical Layers | hot(L1 上下文) / warm(L2 向量库) / cold(L3 归档) 三层 + 自动晋升/降级 |
| 26 | Letta/MemGPT | OS 虚拟内存隐喻：core(常驻) / archival(可搜) / recall(全史)，agent 自己分页 |

**记住**：分层 = **按访问频率分 tier + 逐级 drill-down**，是 CPU cache 的隐喻，也是 TencentDB Agent Memory 的核心主张。12 的「pin」最实用——系统指令、用户偏好应永远钉在上下文，别被 FIFO 冲走。

---

## 模块 5 · 生命周期：记忆怎么维护（14、15、18、19）

核心问题：记忆会重复、冲突、过时、爆炸。四种武器，两两一组。

### 14 Consolidation：合并、去冲突、重算重要性

一个**后台批处理**（定时/达阈值时跑，不是在每次对话时跑）：

1. **聚类**：按语义相似度把相关记忆聚成一簇。
2. **合并**：簇内重复项合成一条更丰富的记忆。
3. **解冲突**：三条策略——**以新为准**（默认）、以置信度高为准、以用户确认为准。
4. **重算重要性**：按访问频率 + 新鲜度 + 结果好坏调整权重。

**关键权衡**：合并是**不可逆的有损操作**——合并完原始的五条就没了。所以 15 才强调「留原文」。

### 15 Compaction：渐进多级压缩，但原文不丢

```
L0 原文(全量) ──压缩──→ L1 要点 ──压缩──→ L2 一句话 ──压缩──→ L3 标签
        ↑冷存储保留                      ↑检索时按需选级
```

日常检索用 L1/L2（信息密度高、省 token），需要精确细节时**下钻回 L0 冷存储**。宣称能把同样存储预算塞进 10–100 倍语义内容。

**核心张力（storage-fidelity tradeoff）**：压得越狠越省钱，但可能丢掉以后要用的细节。**解法是「可逆性」**——原文永远留在冷存储，压缩只是「前置的摘要」。

### 18 Temporal：检索时降权，不删

给每条记忆挂三个时间戳——`created_at`、`last_access_at`、`event_time`（事件实际发生的时间）。

- **recency 加权**：综合分 = `α·语义相似 + β·新鲜度`。
- **时间范围查询**："过去 24 小时发生了什么"。
- **"as of" 查询**（最强大）：**重建「某时刻我知道什么」**——过滤掉该时间戳之后创建的记忆。
- **事件时间线**：按 `event_time` 排序，还原因果链。

### 19 Forgetting：真的删

1. **指数衰减**：`S(t) = S₀·e^(−λt)`，λ 越大忘得越快（艾宾浩斯遗忘曲线）。
2. **访问强化（spaced repetition）**：每次命中，`S(t)` 反弹回 `S₀`——常用记忆长生不老。
3. **剪枝阈值**：`S(t)` 跌破阈值 → 删除或归档。
4. **生命周期**：创建 → 活跃使用 → 衰减 → 剪枝/归档。

### 18 和 19 的实战区别（同一场景）

> 用户 3 月说"住在纽约"，6 月说"搬到洛杉矶"。
> - **18**：两条都留，检索时洛杉矶（更新鲜）排前面；"我 4 月住哪？" → as-of 查询回答纽约。
> - **19**：纽约那条衰减、跌破阈值后被**剪枝删除**；4 月的状态无法重建。

**什么时候用哪个**：需要审计/回溯 → 用 18；存储爆炸、成本敏感 → 加 19。**先上 18 更安全**——不丢数据、可回退。

---

## 模块 6 · 学习与进化（11、16）

| # | 技术 | 本质 |
|---|---|---|
| 11 | Procedural | 存「怎么做」的可复用工作流（skill library），不是「发生了什么」 |
| 16 | Self-Reflection | 任务后自省「为何成/败」，存 lesson 供未来检索（Reflexion 框架） |

- **11 Procedural**：从一次成功执行里剥离「可复用动作序列」，**泛化**（具体值换成占位符——"部署 app X 到 server Y" → "部署 {app} 到 {server}"），存进 skill library。标杆案例是 Voyager（Minecraft agent 写可复用技能）。
- **16 Self-Reflection**：任务结束后三问——"什么做对了？什么做错了？下次怎么做？"，蒸馏成可复用原则入库，下次任务前检索注入。**核心价值：不用重训模型就能让 agent 变好**——用语言反馈替代梯度更新。

**和 09/10 的区别**：09 存"发生了什么"，10 存"事实是什么"，11 存"怎么把它做成"，16 存"上次为什么成/败"。这也正是 TencentDB roadmap 里「Skill generation」要做而还没做的方向。

---

## 模块 7 · 多会话 / 多 agent / agent 自主（21、22、23）

| # | 技术 | 本质 |
|---|---|---|
| 21 | Cross-Session | 序列化 + 按 user ID 持久化 + 冷启动 |
| 22 | Multi-Agent Shared | 共享黑板 + namespace 分区 + 冲突解决（乐观锁） |
| 23 | Memory-as-a-Tool | 把 CRUD 暴露成工具，agent 自己决定存/查/改/删 |

- **21 Cross-Session**：会话结束序列化存盘 → 按 user ID 分片 → 冷启动给模板/问卷 → 记忆大了**只加载「最近 N 条 + 最重要 M 条」**，不全量加载。
- **22 Multi-Agent Shared**：经典 blackboard 架构。关键设计是 **私有 scratchpad**——agent 的草稿只自己可见，**只有成品才写入共享区**，防止半成品污染公共空间。冲突解决用 last-write-wins 或乐观锁（带版本号写，冲突重试）。
- **23 Memory-as-a-Tool**：把 `save_memory` / `search_memory` / `update_memory` / `delete_memory` 做成 4 个 tool，agent 在正常的 tool-use 循环里决定何时调用。**这是「显式工具」vs「隐式管线」两种哲学的分野**——前者透明可控可审计，后者（如 Mem0 自动提取）省心但黑盒。

---

## 模块 8 · 生产框架（24–27）：「别自己造轮子」的四家成品

| 框架 | 本质 | 底层 |
|---|---|---|
| 24 Graphiti | 时序知识图谱，每条边带时间戳 | Neo4j，自托管 |
| 25 Mem0 | 托管记忆层，自动提取 + 去重 | 语义记忆为核心 |
| 26 Letta/MemGPT | 分层记忆，agent 自己分页 | core / archival / recall |
| 27 Zep | 全自动：实体 + 事实 + 时序图，异步 | Graphiti 加持 |

**记住**：这四家 = 模块 2–5 概念的**成品封装**。Mem0 = 语义记忆，Zep/Graphiti = 图，Letta = 分层。TencentDB Agent Memory 是第 5 家，差异化在「团队级共享 + 符号化短时记忆」。

---

## 模块 9 · 评测（28、29）

| # | 技术 | 本质 |
|---|---|---|
| 28 | Evaluation | 自建数据集，指标 = precision/recall/staleness/contradiction + LLM-as-judge |
| 29 | LoCoMo/LongMemEval | 标准基准：单跳/多跳/时间/开放/对抗五类题 |

**四个指标（记牢，多数人只测前两个）：**

- **precision = TP/(TP+FP)**：召回的记忆里有多少相关？（找得准不准）
- **recall = TP/(TP+FN)**：所有相关记忆里找回多少？（找得全不全）
- **staleness**：agent 是否用了**过时**数据？← **记忆系统真正的死穴**
- **contradiction**：库里是否存了**矛盾**事实，能否检测/解决？

**29 标准基准**：LoCoMo 有 10 段多会话对话、约 2000 个 QA 对，分五类（单跳/多跳/时间/开放/对抗），用 BLEU / ROUGE-L / token F1 / LLM judge 打分，跑一轮带 LLM judge 约 $5–15。关键做法是**跑「无记忆 baseline」做对照**，量化检索到底加了多少价值。

---

## 模块 10 · 生产工程（30）

caching(Redis) / TTL / 水平分片 / 备份恢复 / **GDPR 删除（连 embedding、图节点一起删）** / 可观测性 / 成本管理。

---

## 收束：核心心智模型 + 实践清单

30 个技术最终收敛成 5 条底层逻辑：

1. **上下文窗口是稀缺资源**——记忆的本质是「换出 + 换回」。
2. **存储是分层的，检索是混合的**——拒绝扁平向量堆。
3. **记忆有生命周期**——去重、解冲突、让旧知识失效。
4. **谁来管记忆有两种范式**——agent 显式工具 vs 系统隐式管线。
5. **评测是硬指标**——重点看 staleness 和 contradiction，不只是 precision/recall。

**最小阅读路径（只看 6 个就够）**：

```
04 → 10 → 20 → 14 → 19 → 28
```

这条链 = 短期分割点 → 长期事实抽取 → 混合检索 → 维护 → 遗忘 → 评测，覆盖全部 5 条底层逻辑，其余 24 个是变体。

**给自建记忆系统的四步清单**（对应四个最常见的短板）：

| 短板 | 解法 | 最小可行 |
|---|---|---|
| 只有人工导航，没有语义召回 | 06 + 20 | 向量 + BM25 + RRF（hybrid） |
| 重复、冲突、不可逆合并 | 14 + 15 | 三策略解冲突 + 留原文 |
| 旧结论永远占坑 | 18 + 19 | 先上 18（recency 加权，不删数据） |
| 无法量化好坏 | 28 | precision/recall + staleness |

---

## 参考

- [NirDiamant/Agent_Memory_Techniques](https://github.com/NirDiamant/Agent_Memory_Techniques)
- [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
- [Graphiti](https://github.com/getzep/graphiti)、[Mem0](https://github.com/mem0ai/mem0)、[Letta/MemGPT](https://github.com/letta-ai/letta)、[Zep](https://github.com/getzep/zep)
- Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning," 2023
- Wang et al., "Voyager: An Open-Ended Embodied Agent with Large Language Models," 2023
