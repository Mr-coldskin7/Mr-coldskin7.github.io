---
title: learn claude code项目学习
date: 2026-05-10 11:21:00 +0800
categories: [Study, agent]
tags: [study]
---
这是一个学习关于agent一些架构的项目
我学习到的 比较重要的东西 主要就是关于如何分工和持久化的问题
第一学习到的就是关于skill的两层注入，第一层是写的比较简洁的，第二层是写的比较完整的
我们需要做的就是分开然后适时的注入进上下文里面，这个项目的注入时机是agent自主调用tool的时候获得的
这我觉得还是有一部分道理的 毕竟作为agent 保证agent的自主性是非常重要的
过度的harness会导致整体是个workflow，而不是agent
还有关于子agent的设计问题，这里面是通过持久化一个json保存相关的信息人设一类的内容，之后再注入进去
这确实是一个值得学习的一个点
还有关于工作环境的点，大家都知道要做sandbox，这里面是用git worktree来隔离的，我觉得也算是一种思路吧
这里面我觉得写的不太好的就是关于任务系统 让agent来自主去抢任务的设计，我觉得这个任务很失败，没太有意义
首先他的调度系统就写的不好，如果调度系统可以根据任务的优先级或者agent擅长什么来调度的话，可能算是一个分布式agent的好方案
但我还是比较系统那种大agent指挥小agent的模式，规划跟执行的agent最好是不一样的，规划的agent能力应该更强，执行的agent应该价格更便宜，这些应该都是相互的
关于任务图的方面，我一开始觉得他的设计没有强制使用树结构，但是后来想想，这其实也是个好的设计，因为实践是最好认识一个事务的方式，agent不可能一开始就是规划的是对的，他需要频繁修改调整任务，如果用比较重或者比较强的图约束的话，那其实变相的削弱了agent本身的能力
在上下文管理方面，我还是学到一些的，可能之前接触到的都是类似于八股之类的说法，滑动窗口啊之类的，这里他说的memory的处理我个人还是比较认同的 学习了
下面是ai总结的点

## 各 Session 示例总结

这个项目从 s01 到 s12 是逐步递进的，每个 session 在基础循环上加一个 harness 机制，下面逐个说一下：

### s01 - Agent Loop（Agent 循环）
最基础的一个 agent 实现。就一个 `while True` 循环 + 一个 `bash` 工具。模型调用工具时循环继续，不调用时就停止返回结果。核心思想是：**循环本身永远不变**，后面所有机制都是往这个循环外面加东西。不到 30 行代码就是一个 agent。

### s02 - Tool Use（工具使用）
在 s01 基础上扩展了工具集，从只有 `bash` 增加到 `bash/read_file/write_file/edit_file` 四个。关键设计是 **dispatch map**（一个字典把工具名映射到处理函数），加新工具只需要注册 handler，循环代码完全不用改。另外加了 `safe_path()` 路径沙箱，防止 agent 越权访问工作目录之外的文件。

### s03 - TodoWrite（待办写入）
引入了 `TodoManager` 规划工具，让 agent 在执行前先列步骤、执行中更新状态。设计上有两个强制机制：一是**同时只能有一个 `in_progress` 任务**，强迫顺序聚焦；二是**nag reminder**，如果 agent 连续 3 轮不更新 todo，系统会自动注入提醒。解决的是长对话中模型忘记原计划、开始即兴发挥的问题。

### s04 - Subagents（子 Agent）
解决上下文膨胀问题。父 agent 通过 `task` 工具派生子 agent，子 agent 用**完全独立的 `messages[]`** 运行自己的循环，干完活只把最终摘要文本返回给父 agent，整个子对话历史直接丢弃。这样父上下文永远保持干净。子 agent 没有 `task` 工具防止递归爆炸。

### s05 - Skills（Skill 加载）
**两层注入**的知识管理机制，这也是你笔记里重点提到的一个点。第一层（系统提示）只放 skill 的名称和简短描述（便宜）；第二层（tool_result）在模型主动调用 `load_skill` 时才注入完整内容（按需付费）。避免了一次性把所有领域知识塞进系统提示的浪费。skill 文件就是带 YAML frontmatter 的 `SKILL.md`。

### s06 - Context Compact（上下文压缩）
解决上下文窗口超限的问题，设计了三层压缩策略，激进程度递增：
- **Layer 1 micro_compact**：每轮静默把超过 3 轮的旧 tool result 替换成占位符（如 `[Previous: used bash]`）
- **Layer 2 auto_compact**：token 超过阈值时，自动保存完整对话到 `.transcripts/`，让 LLM 做摘要，然后把消息列表替换成摘要
- **Layer 3 compact tool**：提供 `compact` 工具让模型主动触发摘要
原始对话保存在磁盘，信息没真正丢失，只是移出了活跃上下文。

### s07 - Task System（任务系统）
把 s03 的内存 todo 清单升级为**持久化到磁盘的任务图**。每个任务是一个 JSON 文件，有 `pending -> in_progress -> completed` 状态，支持 `blockedBy` 依赖关系。可以表达并行（多个任务同时 pending）、顺序（A 做完 B 才能开始）、汇聚（C 和 D 都做完 E 才能开始）等结构。这是后面多 agent 协作的协调骨架，压缩或重启后任务状态不丢失。

### s08 - Background Tasks（后台任务）
解决慢命令阻塞问题。`npm install`、`pytest` 这种命令用**守护线程**在后台跑，主循环继续让 agent 思考下一步。后台任务完成后结果进入**线程安全的通知队列**，在下次 LLM 调用前注入上下文。agent 可以同时 spawn 多个后台任务并行跑。

### s09 - Agent Teams（Agent 团队）
从单 agent 进入多 agent 协作。核心设计是：
- **持久化队友**：`config.json` 维护团队名册，队友有名字、角色、状态
- **JSONL 邮箱**：`.team/inbox/alice.jsonl` 这种 append-only 文件做通信通道，`send()` 追加一行，`read_inbox()` 读取并清空
- 每个队友在自己的线程里跑完整的 agent loop，每次 LLM 调用前检查收件箱
和 s04 的一次性子 agent 不同，这里的队友是**跨多轮对话存活**的。

### s10 - Team Protocols（团队协议）
在 s09 基础上增加**结构化协调协议**。两种场景：
- **关机协议**：领导请求关机 -> 队友批准（收尾退出）或拒绝（继续干）
- **计划审批**：队友提交计划 -> 领导审查批准或拒绝
两者都是同一个 **request-response + FSM** 模式：一方发带 `request_id` 的请求，另一方引用同一个 ID 响应，状态机是 `pending -> approved | rejected`。

### s11 - Autonomous Agents（自治 Agent）
解决领导手动分配任务的扩展性问题。队友进入 **IDLE 阶段**后不再等着被指派，而是每 5 秒轮询一次：先看收件箱有没有新消息，再看任务板上有没有 `pending + 无 owner + 无依赖` 的未认领任务，有就自动认领并切换回 WORK 阶段。60 秒空闲超时自动关机。另外加了**身份重注入**：上下文压缩后如果消息太少，自动在开头插入 "你是谁" 的提示，防止 agent 失忆。

### s12 - Worktree + Task Isolation（Worktree 任务隔离）
最终章，解决多 agent 共享目录的文件冲突问题。用 **git worktree** 给每个任务创建独立的工作目录，任务和 worktree 双向绑定（`task_id <-> worktree_name`）。执行命令时 `cwd` 指向隔离目录。收尾有两种选择：`worktree_keep` 保留目录供后续使用，`worktree_remove` 删除目录并自动完成任务。还加了 `.worktrees/events.jsonl` 事件流记录生命周期步骤，崩溃后可从磁盘重建现场。

---

以上就是全部 12 个 session 的核心内容。整体看下来，这个项目确实是在教你**怎么给模型搭 harness**，而不是替模型做决定。从单循环 -> 多工具 -> 规划 -> 子 agent -> 知识注入 -> 内存管理 -> 持久化任务 -> 后台执行 -> 多 agent 团队 -> 团队协议 -> 自治 -> 目录隔离，一层一层往上加，但底层的 agent loop 始终没变。