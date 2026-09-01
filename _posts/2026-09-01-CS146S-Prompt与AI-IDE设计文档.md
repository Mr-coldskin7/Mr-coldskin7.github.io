---
layout: post
title: CS146S 学习笔记：从 Prompt 技术全景到 AI IDE 设计文档规范
date: 2026-09-01 21:00:00 +0800
categories: [CS146S]
tags: [cs146s, llm, prompt-engineering, ai-ide, agent, design-doc]
giscus_comments: true
---

# CS146S 学习笔记：从 Prompt 技术全景到 AI IDE 设计文档规范

> 本文整合 CS146S（斯坦福《现代软件开发者》）前 3 周的核心内容：
> **Week 1 的 8 种 Prompt 技术 + 通用 Best Practices**，与 **Week 3 的「产品经理式」设计文档（8 字段 Spec + 完整模板）+ 让代码库对 Agent 友好的 Best Practices**。
>
> 一张图理解递进关系：**提示词（让 LLM 说话）→ 工具/MCP（让 LLM 做事）→ 设计文档（让 Agent 替你写复杂代码）**。

---

## 一、Week 1：LLM 高效提示（Power Prompting）的 8 种技术

讲义《Power Prompting for LLMs》把提示技术分成两大类：**「不给例子」与「给例子」**，再加上**让模型自我纠错**的高级玩法。核心观点：Prompting 既是艺术也是科学——LLM 是黑盒，但有经验证有效的固定套路。

### 1.1 Zero-shot Prompting（零样本提示）

直接提要求，**不给支持、不给例子**。

```text
Write me a Rust for-loop that iterates over a list of strings, printing every value in an even index
```

| 维度 | 说明 |
|------|------|
| 适用 | 简单、常规、模型已经见过的任务 |
| 优点 | 省事、快 |
| 缺点 | 对格式/风格敏感的任务容易翻车 |

### 1.2 K-shot Prompting（少样本提示 / In-Context Learning）

在 prompt 里塞几个「怎么做」的例子。k 通常取 **1、3、5**（有实证支撑）。**适合推理步骤不多的任务**——例子越多模型越容易照葫芦画瓢，但推理型任务光给例子不够。

```text
Write a for-loop iterating over a list of strings using the naming convention in our repo.
Here are some examples of how we typically format variable names:
<example>var StRaRrAy = ['cat', 'dog', 'wombat']</example>
<example>def func CaPiTaLiZeStR = () => {}</example>
```

### 1.3 Chain-of-Thought Prompting（思维链 CoT）

让模型**先推理再作答**，适合多步骤逻辑任务（编程、数学）。三种变体：

- **Multi-shot CoT**：给出带推理过程的示例
- **Zero-shot CoT**：直接加一句「Let's think step-by-step」
- **显式推理标签**：要求输出放在 `<reasoning>` 标签里

```text
Write a function to find the longest increasing subsequence in an array.
Think step by step about the subproblems before coding.
Include worked out examples of subarrays you are considering as you answer this question.
```

### 1.4 Self-consistency Prompting（自洽性采样）

对同一个问题**采样多次（通常配 CoT），取多数结果**。本质是「模型集成」——通过多样化推理路径投票，抑制幻觉和偶发错误。适合对正确性敏感、但成本可接受的场景（如抓 bug）。

```text
What's the root cause for this error: <traceback>...</traceback>
# 同一问题 Prompt 5 次，取多数答案
```

### 1.5 Tool Use（工具使用）

允许 LLM **把动作外包给外部系统**（执行测试、查询 API）。讲义强调：这是**降低幻觉、让 LLM 获得自主性**最重要的技术之一——也是后续 MCP、Agent 的起点。

```text
Fix the IndexError. Ensure the CI tests still pass once you have made the fix.
Here are the available tools:
<tools>
pytest -s /path/to/unit_tests
pytest -v /path/to/integration_tests
</tools>
```

### 1.6 Retrieval Augmented Generation（RAG，检索增强生成）

把**上下文数据注入 prompt**：不重训模型就保持信息最新、天然带引用和可解释性、减少幻觉。

```text
Here is how the UserAuthService works now:
<code_snippet>...</code_snippet>
Here is the path to the requests-oauthlib documentation:
<url>https://requests-oauthlib.readthedocs.io/en/latest/</url>
```

### 1.7 Reflexion（反思）

让 LLM **批评自己的输出**并重试，通过多轮对话把环境反馈重新注入上下文。

```text
Turn 1: 模型给出初版答案
Turn 2: "Now critique your answer. Was it correct? If not, explain why and try again."
```

讲义里的例子展示了完整闭环：**observe（测试报 JSONDecodeError）→ reflect（我扩展了 company_location，需兼容字符串输入）→ 扩展 prompt 重试**。

### 1.8 基础术语（别搞混）

| 术语 | 含义 |
|------|------|
| **System prompt** | 发给 LLM 的第一条消息（用户通常看不到），定义人设、输出规则、风格 |
| **User prompt** | 人类真正的请求/指令（前面所有例子都是） |
| **Assistant** | LLM 实际生成的内容（即 `role=assistant` 的历史输出） |

---

## 二、Week 1 Best Practices：通用提示工程

1. **用 Prompt Improver 迭代**——Anthropic 官方有专门的 prompt 改进工具，写完先过一遍。
2. **清晰第一**——把你的 prompt 给一个毫无上下文的人看：**如果他会困惑，LLM 一定也会**。
3. **大胆用 Role Prompting**——让 system prompt 更强：`"You are a helpful assistant that loves programming at the level of a senior software developer and is very detailed and pedantic in your answers."`
4. **结构化格式**——用 `<log>`、`<error>` 等标签把日志和堆栈包起来，模型更容易定位。
5. **明确说明想要什么**——语言、技术栈、库、约束，别让模型猜。
6. **拆解任务**——大任务拆成小步骤，一次只让模型做一件定义清楚的事。

---

## 三、Week 3：复杂任务 = 产品经理思维（8 字段 Spec）

Week 3 讲义（The AI IDE: Fundamentals to Power User）提出一个关键转变：

> **简单改动，不需要太费心思写 prompt；复杂任务，你要变成产品经理——精心撰写规格文档（spec doc）。**

简化版规格文档只需 **8 个字段**，但正是「给 Agent 写需求」的最小完备集：

| # | 字段 | 含义 |
|---|------|------|
| 1 | **Goal** | 这次改动的目的是什么 |
| 2 | **Definitions** | LLM 需要先知道哪些前置知识/术语 |
| 3 | **Plan** | 高层实现拆解 |
| 4 | **Source files being changed** | 涉及哪些源码文件，为什么相关 |
| 5 | **Test cases** | 测试怎么做 |
| 6 | **Edge cases** | 有哪些特殊情况要处理 |
| 7 | **Out-of-scope** | **明确不要改什么**（防止 Agent 顺手重构） |
| 8 | **Extensions** | 以后哪些改动会相关，让 LLM 提前做可扩展设计、别走捷径 |

> 💡 实用提示：**「Out-of-scope」往往是 8 个字段里最容易被新手忽略、但对 Agent 最管用的一个**——不说清边界，Agent 很容易顺手做超出范围的重构。

### 3.1 完整版 Design Doc 模板

课程仓库还提供了一个**更完整的 12 节设计文档模板**（`design_doc_template.md`），适合真正的大改动，与上面的 8 字段正好互补：

| 模块 | 内容 |
|------|------|
| **Current Context** | 现有系统概览、关键组件关系、要解决的痛点 |
| **Requirements** | 功能需求（必须做什么）+ 非功能需求（性能/可扩展/可观测/安全） |
| **Design Decisions** | 每个重大决策：选什么方案 + 理由 + 备选方案权衡 |
| **Technical Design** | 核心组件、数据模型（带类型注解）、集成点、**Files Changes（唯一受影响文件清单）** |
| **Implementation Plan** | 分阶段：Phase 1 初期实现 → Phase 2 增强 → Phase 3 生产就绪 |
| **Testing Strategy** | 单元测试（mock 策略、覆盖预期）+ 集成测试（场景、环境、数据） |
| **Observability** | 日志（关键点/级别/结构化格式）、指标（采集方式/告警阈值） |
| **Future Considerations** | 潜在增强、已知限制、技术债 |
| **Dependencies** | 构建工具、测试框架、开发工具 |
| **Security** | 认证授权、数据保护、合规 |
| **Rollout Strategy** | 开发 → 测试 → 预发布 → 生产 → 监控 |
| **References** | 关联设计文档、外部文档、相关标准 |

**用法建议**：8 字段 Spec 是「电梯版」，适合把任务交给 Agent 时写进 prompt；12 节模板是「正片版」，适合要评审的大改动。小任务用 8 字段，大任务把 12 节模板作为仓库里的文档资产。

---

## 四、Week 3 Best Practices：让代码库对 Agent 友好

设计文档解决「这次任务」，下面的实践解决「这个仓库」——两者叠加，Agent 才能高效工作。

### 4.1 优化代码库，让人类和 Agent 都能看懂

> 大量 LLM 的困惑源于**在混乱的仓库上硬完成任务**。为 LLM 提供最佳上下文 = 把以下内容**全部写成文档**：

- Repo 导航（Repo orientation）
- 文件结构（File structure）
- 环境与启动（Setup and environment）
- 最佳实践（Best practices）
- 代码风格（Code style）
- 访问模式（Access patterns）
- API 与契约（APIs and contracts）

💡 讲义特别建议：**仓库用 monorepo 结构**，减少 Agent 跨仓库找文件的成本。

### 4.2 用 Agent 配置文件提供「导航」

| 文件 | 作用 |
|------|------|
| **CLAUDE.md** | Claude 启动对话时自动拉入上下文：常用 bash 命令、核心文件与工具函数、代码风格、测试指引 |
| **.cursorrules** | Cursor 的规则文件（类似用途） |
| **AGENTS.md** | 开放格式的跨工具 Agent 指引标准 |
| **llms.txt** | 给爬取网页的 LLM 看的站点导航 |

> ⚠️ 注意：**Agent 不一定会遵守这些描述/指令**——它们只是「指引」（guidance），不是硬约束。别指望写了 CLAUDE.md 模型就 100% 照做，它只是显著提高正确率。

### 4.3 附赠：AI IDE 底层原理（知道这些，写 prompt 才有手感）

- **Tab 补全**：围绕当前代码的小上下文窗口 → 发送到服务器跑 infilling 模型 → 返回补全建议。
- **Chat 模式**：代码块以 embedding 存入语义索引（服务端，文件名+代码混淆）→ 查询时检索最相关 chunks 作为上下文 → IDE 定期重索引，**chunk 差异用 Merkle 树计算**以高效同步更新。

理解「Chat 模式 = 语义检索 + 拼上下文」，就能明白为什么设计文档、CLAUDE.md 这类**结构化上下文**对 AI IDE 如此重要。

---

## 五、一页速查表

```
Week 1 — 8 种 Prompt 技术
╔══════════════════════╦══════════════════════════════════════════╗
║ Zero-shot            ║ 不给例子直接问                            ║
║ K-shot               ║ 给 1/3/5 个例子（in-context learning）    ║
║ Chain-of-Thought     ║ 先推理再答；"think step-by-step"          ║
║ Self-consistency     ║ 采样多次取多数，抗幻觉                    ║
║ Tool Use             ║ 外包给外部系统，自主性的起点              ║
║ RAG                  ║ 注入检索上下文，带引用、更新鲜            ║
║ Reflexion            ║ 自己批评自己，多轮重试                    ║
║ System/User/Assistant║ 人设 / 请求 / 模型输出                    ║
╚══════════════════════╩══════════════════════════════════════════╝

Week 3 — 把任务交给 Agent 前
1. 简单改动 → 直接 prompt
2. 复杂改动 → 8 字段 Spec（Goal/Definitions/Plan/Files/Tests/Edge cases/Out-of-scope/Extensions）
3. 大改动   → 12 节 Design Doc 模板
4. 仓库治理 → CLAUDE.md + 文档化的 repo 导航 + monorepo
```

**一句话总结**：Week 1 教你怎么和 LLM「说话」，Week 2 教你怎么让它「用工具」（MCP），Week 3 教你怎么把「做复杂项目的项目管理能力」也交给它——**写好设计文档，是你从使用者变成 Agent 管理者的分水岭**。