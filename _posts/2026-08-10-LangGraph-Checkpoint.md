---
layout: post
title: LangGraph Checkpoint 详解
date: 2026-08-10 15:36:52 +0800
categories: [agent]
tags: [agent, langgraph, checkpoint, memory, durable-execution]
description: LangGraph checkpoint 机制深挖——每步 state 快照 + WAL 耐久执行, thread_id 定位会话, checkpoint_id 定位步骤。
---

# LangGraph Checkpoint 详解

> 本文是面试向的回忆笔记: LangGraph 的短期记忆底层 —— checkpoint。从"是什么"到"怎么实现"再到"能干嘛", 按面试答题结构组织。

## 一句话定位

LangGraph 不是普通 API 调用, 是 Pregel 风格状态机。每次 `invoke` 是图上跑一轮 **superstep** (节点执行)。**checkpoint = 某个 superstep 结束后, 对整个图 state 做的一次快照**, 存进 checkpointer。图跑多少步, 就留多少个快照 —— 类似 git, 每次 commit 一个状态。

## 何时写、存什么

每次节点执行完 (一个 superstep 完成), 自动写一个 checkpoint。存三样:

| 字段 | 内容 |
|---|---|
| `checkpoint` | 所有 channel 的值 (即完整 state, 含 messages 列表) + 各 channel 版本号 |
| `metadata` | `created_at`、`step`、`source` (input/loop/update)、`writes` (这步写了啥)、`parents` (父线程引用) |
| `key` | `thread_id` + `checkpoint_id` |

channel 版本号很关键: 并发写时靠它做冲突检测。`checkpoint_id` 是**时间序 UUID (v7)**, 保证排序可靠。

## 核心接口 `BaseCheckpointSaver`

4 个方法, 能背这个就是加分:

```python
class BaseCheckpointSaver:
    def get_tuple(config) -> CheckpointTuple: ...   # 读某 checkpoint
    def list(config, *, limit, before) -> iterator: ... # 枚举某线程历史
    def put(config, checkpoint, metadata, new_versions): ... # 写快照
    def put_writes(config, writes, task_id, task_path): ...   # 写 pending writes
```

**`put_writes` 是精髓 —— 预写日志 (WAL)**。节点输出先落盘 `writes`, 再写 checkpoint。好处:

- 崩溃恢复: 进程挂了, checkpoint 在但 writes 未刷? 从 WAL 重放节点输出, 不丢半步。
- 不需要重跑已完成节点, 直接接着跑。这就是 LangGraph 的**耐久执行 (durable execution)**。

## `thread_id` vs `checkpoint_id`

面试最容易考这个区分:

- **`thread_id`** = 会话维度。同一次对话共享。换 id = 新对话。定位"哪个人"。
- **`checkpoint_id`** = 步骤维度。线程内每次快照一个。像 git 的 commit hash。定位"哪一步"。

```
thread_id: "1"  ── checkpoint_id: aaa (step 0)
                ── checkpoint_id: bbb (step 1, 含工具调用)
                ── checkpoint_id: ccc (step 2, 最终回答)
```

线程"当前状态" = 最新 `checkpoint_id` 那份。所以记忆 = 每次 invoke 从最新快照恢复 state, 再往里塞新输入。

## 一次 `invoke` 完整流程

```
agent.invoke({messages:[Q2]}, config)
  1. 查 checkpointer: thread "1" 最新 checkpoint → 取回 [Q1, A1]
  2. state = 旧state + [Q2]
  3. 图上跑: model 节点 → 可能 tool 节点 → 每步写新 checkpoint
  4. 返回最终 state
```

所以第二问能看到 Q1+A1 不是魔法, 是 **state 恢复 + 全量重发**。`checkpointer=None` 时第 1 步查不到任何东西 → 裸调用, 无记忆。

## 短记忆 vs 长记忆 (关键辨析)

- **checkpoint = short-term memory**: 按 thread 记对话内状态。`InMemorySaver` 存内存, 进程重启全没 → 纯短期。换 `SqliteSaver`/`PostgresSaver` (durable store) → 跨重启, 但仍是"会话内"。
- **长期记忆 = `Store` API** (`BaseStore`), 不是 checkpointer。跨线程、经语义检索、专门挑出的长期事实。两者别混, 面试常见坑。

## checkpoint 解锁的高级能力

### a) Time travel (时间旅行)

```python
state_history = agent.get_state_history(config)   # 该线程所有快照
past = state_history[2]                           # 回退到任意一步
agent.update_state(config, values, as_node="...") # 改某个中间状态
```

拿到任意 `checkpoint_id`, 就能**从历史任一步 fork 出新分支** —— 调试、回溯、回滚都靠这个。

### b) Interrupt / Human-in-the-loop

```python
from langgraph.types import interrupt
value = interrupt({"question": "approve?"})       # 暂停, 已存 checkpoint
# 之后:
agent.invoke(Command(resume="yes"), config)       # 同 thread 恢复, 不用重跑
```

中断时 checkpoint 已落盘 → 暂停多久都行, 恢复时从断点继续。这是 HITL 的底层机制。

### c) 失败重试

checkpoint 让"跑了一半挂了"变得廉价, 从最近快照续跑。

## 面试加分总结句

"LangGraph 的 checkpoint 是每步 state 快照 + WAL 的耐久执行机制。`thread_id` 定位会话、`checkpoint_id` 定位步骤; 靠它实现记忆、时间旅行、中断恢复。短记忆是会话级 checkpoint, 长记忆是 Store。"

## 结合实践

课程 notebook 里的写法:

```python
from langgraph.checkpoint.memory import InMemorySaver

agent = create_agent(
    "anthropic:deepseek-v4-flash",
    checkpointer=InMemorySaver(),  # 开启记忆
)

config = {"configurable": {"thread_id": "1"}}

# 第一问
response = agent.invoke({"messages": [question]}, config)

# 第二问: 模型能"记得"第一问, 因为 state 从 thread "1" 恢复
```

`create_agent(...)` + `checkpointer=InMemorySaver()` + 传 `config` 带 `thread_id` —— 就是开了短记忆。内存存, 重启即失。
