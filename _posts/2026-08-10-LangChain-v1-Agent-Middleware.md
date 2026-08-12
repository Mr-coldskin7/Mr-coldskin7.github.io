---
layout: post
title: LangChain v1 Agent Middleware 笔记
date: 2026-08-10 15:50:00 +0800
categories: [agent]
tags: [agent, langchain, middleware, hook, agent-loop]
description: LangChain v1 中间件机制详解——Agent 核心循环前后的 hooks, 控制输入输出、工具调用、消息摘要与修剪。
---

# LangChain v1 Agent Middleware 笔记

> 整理自课程 notebook 与 LangChain 中文文档 [中间件](https://langchain-doc.cn/v1/python/langchain/middleware.html) 章节。

## 一句话定位

**Middleware 是插入在 Agent 核心循环前后的 hooks**, 用来控制输入、输出、工具调用、消息修剪、日志监控等。

核心循环:

```
调用模型 → 模型选择工具 → 执行工具 → 重复直到模型不再调用工具
```

中间件在以上步骤的**之前和之后**暴露钩子。

---

## 1. 为什么需要中间件

Agent 自动调用模型和工具, 但有时你需要在关键节点"插手":

- 历史消息太长 → 自动摘要或截断
- 工具结果太脏 → 清洗后再给模型
- 某些 ToolMessage 不想进上下文 → 删掉
- 想记录日志、监控耗时、做权限检查
- 想修改模型输入或输出

这些横切关注点不该写进每个 tool 或 prompt 里, 用中间件统一处理最干净。

---

## 2. 两种写法

### 2.1 内置中间件

`SummarizationMiddleware`: 自动摘要历史消息。

```python
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents.middleware import SummarizationMiddleware

agent = create_agent(
    model="anthropic:deepseek-v4-flash",
    checkpointer=InMemorySaver(),
    middleware=[
        SummarizationMiddleware(
            model="anthropic:deepseek-v4-flash",  # 负责摘要的模型
            trigger=("tokens", 100),               # token 超过 100 触发
            keep=("messages", 1)                   # 保留最近 1 条原消息
        )
    ],
)
```

参数含义:

| 参数 | 含义 |
|---|---|
| `model` | 做摘要的模型, 可与主模型不同 |
| `trigger` | 触发条件, 这里是总 token 数 |
| `keep` | 摘要后保留最近几条原消息 |

效果: 老对话被压缩成 summary + 最近消息, 省 token 又不失上下文。

### 2.2 自定义中间件

用 `@before_agent` 或 `@after_agent` 装饰函数。

```python
from typing import Any
from langchain.agents import AgentState, create_agent
from langchain.agents.middleware import before_agent
from langchain.messages import RemoveMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.runtime import Runtime

@before_agent
def trim_messages(state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
    """每次 agent 运行前, 删除所有 ToolMessage"""
    messages = state["messages"]
    tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
    return {"messages": [RemoveMessage(id=m.id) for m in tool_messages]}

agent = create_agent(
    model="anthropic:deepseek-v4-flash",
    checkpointer=InMemorySaver(),
    middleware=[trim_messages],
)
```

函数签名:

```python
def hook(state: AgentState, runtime: Runtime) -> dict | None:
    ...
```

- `state`: 当前 Agent 状态, 含 `messages`
- `runtime`: 运行时上下文, 含 `config`、`context` 等
- 返回 `dict`: 合并进 state
- 返回 `None`: 不修改 state

---

## 3. 与 hook 的关系

概念上完全等价:

| 通用说法 | LangChain v1 名字 | 执行时机 |
|---|---|---|
| pre-hook | `@before_agent` | 模型调用前 |
| post-hook | `@after_agent` | 模型调用后 |
| pre-tool hook | `@before_tool` | 工具执行前 |
| post-tool hook | `@after_tool` | 工具执行后 |
| middleware | `middleware=[...]` 列表 | 统一注册 |

## 4. 执行顺序

假设:

```python
middleware=[A, B, C]
```

before 阶段正序, after 阶段逆序:

```
输入 → A.before → B.before → C.before → agent 核心 → C.after → B.after → A.after → 输出
```

和常见 Web 框架的中间件洋葱模型一致。

---

## 5. 常见用途总结

| 用途 | 实现方式 |
|---|---|
| 消息摘要 | `SummarizationMiddleware` |
| 消息修剪/删除 | `@before_agent` 返回 `RemoveMessage` |
| 工具参数校验 | `@before_tool` |
| 工具结果清洗 | `@after_tool` |
| 输入输出日志 | `@before_agent` + `@after_agent` |
| 权限检查 | `@before_agent` |
| 缓存 | `@before_agent` 查缓存, `@after_agent` 写缓存 |

---

## 6. 关键对象

### `AgentState`

Agent 的当前状态, 至少包含:

```python
{"messages": [HumanMessage, AIMessage, ToolMessage, ...]}
```

中间件可以读、改这个 state。

### `Runtime`

运行时容器, 包含:

- `config`: 当前调用配置, 如 `{"configurable": {"thread_id": "1"}}`
- `context`: 通过 `context_schema` 注入的用户上下文
- 其他运行信息

### `RemoveMessage`

用于从 state 中删除消息:

```python
from langchain.messages import RemoveMessage

RemoveMessage(id=message.id)
```

返回它, LangGraph 会在状态更新时移除对应消息。

---

## 7. 一句话总结

LangChain v1 的 middleware 是 **Agent 核心循环上的 hook 层**: `@before_agent` 在模型前改输入, `@after_agent` 在模型后改输出, 内置 `SummarizationMiddleware` 做自动摘要, 所有逻辑通过 `middleware=[...]` 注册到 agent 上统一执行。
