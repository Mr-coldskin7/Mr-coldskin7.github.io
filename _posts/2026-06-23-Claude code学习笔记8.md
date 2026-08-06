---
layout: post
title: Claude code学习8 system-reminder，动态信息是如何入prompt的
date: 2026-06-23 22:21:00 +0800
categories: [agent]
tags: [agent, claude-code, system-reminder]
---

### system-reminder

在之前讲到了需要关于静态prompt以及缓存的内容，既然每一轮会变得东西要保存缓存要往后放，那例如今天日期，git分支、。Claude Code 的解法是把高频变化事实从 System Prompt 拿出来，用 <system-reminder> 包装后放进消息流。CLAUDE.md、Memory 召回、文件读取警告和工具引用说明一类容易变化的

```ts
export function prependUserContext(messages: Message[], context: { [k: string]: string }): Message[] {
  if (process.env.NODE_ENV === "test") {
    return messages;
  }

  if (Object.entries(context).length === 0) {
    return messages;
  }

  return [
    createUserMessage({
      content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${Object.entries(context)
        .map(([key, value]) => `# ${key}\n${value}`)
        .join("\n")}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
      isMeta: true,
    }),
    ...messages,
  ];
}
```

它把 context 字典（如 claudeMd、currentDate）格式化成 Markdown 标题，再包进 <system-reminder>，作为一条 meta user message 插入到所有消息前面。isMeta: true 表示它不是用户真正输入的内容。
像是这里的context获取有两种context，一种是类似claude.md和memory一类user的context

```ts
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string;
  }> => {
    const startTime = Date.now();
    logForDiagnosticsNoPII("info", "user_context_started");

    // CLAUDE_CODE_DISABLE_CLAUDE_MDS: hard off, always.
    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    // --bare means "skip what I didn't ask for", not "ignore what I asked for".
    const shouldDisableClaudeMd =
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) || (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0);
    // Await the async I/O (readFile/readdir directory walk) so the event
    // loop yields naturally at the first fs.readFile.
    const claudeMd = shouldDisableClaudeMd ? null : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()));
    // Cache for the auto-mode classifier (yoloClassifier.ts reads this
    // instead of importing claudemd.ts directly, which would create a
    // cycle through permissions/filesystem → permissions → yoloClassifier).
    setCachedClaudeMdContent(claudeMd || null);

    logForDiagnosticsNoPII("info", "user_context_completed", {
      duration_ms: Date.now() - startTime,
      claudemd_length: claudeMd?.length ?? 0,
      claudemd_disabled: Boolean(shouldDisableClaudeMd),
    });

    return {
      ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    };
  }
);
```

> 为什么 CLAUDE.md 和 Memory 不应该常驻静态 Global Cache？请同时回答缓存和隐私两个角度。
> 因为 CLAUDE.md 和 Memory 既不是静态的，也不是全局通用的。把它们放进“常驻静态 Global Cache”会导致缓存失效和隐私隔离双重问题。
> CLAUDE.md和/ Memory有的时候是项目级别的，如果作为全局cache的话经常会失效，并且作为项目的缓存，放在全局可能会有泄露的风险
> 并且这两个文件的更改频率较多
> src/utils/claudemd.ts 里明确把它们当成磁盘文件来发现：

// Managed memory (eg. /etc/claude-code/CLAUDE.md) - Global instructions for all users
// User memory (~/.claude/CLAUDE.md) - Private global instructions for all projects
// Project memory (CLAUDE.md, .claude/CLAUDE.md, ...)
// Local memory (CLAUDE.local.md in project roots) - Private project-specific instructions

用户随时可能：

- 直接编辑 CLAUDE.md 或 .claude/memory/*.md
- 用 /remember 写入新记忆
- 用 /compact 压缩或清理记忆
- 用 /clear caches 重置上下文

如果这些东西被塞进一个不会失效的静态 Global Cache，模型就会一直读到旧版本。

1. 当前实现就是“有生命周期的缓存 + 显式失效”

src/context.ts:155-189

export const getUserContext = memoize(async () => {
const claudeMd = shouldDisableClaudeMd
? null
: getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))

return {
...(claudeMd && { claudeMd }),
currentDate: `Today's date is ${getLocalISODate()}.`,
}
})

它用了 lodash-es/memoize，只会在当前进程内缓存，并且源码中有很多显式失效点：

- src/context.ts:29-34：system prompt injection 改变时立即 getUserContext.cache.clear()
- src/commands/clear/caches.ts:52-53：/clear caches 时清空
- src/commands/compact/compact.ts:63,117,203：压缩记忆后清空

export function setSystemPromptInjection(value: string | null): void {
systemPromptInjection = value
getUserContext.cache.clear?.()
getSystemContext.cache.clear?.()
}

这说明设计者的假设是：CLAUDE.md / Memory 可以缓存，但必须是可失效的、进程级的，而不是静态 Global 的。

3. 还有时间敏感内容

currentDate 每天都会变，src/memdir/memoryAge.ts:49-52 还会根据文件修改时间生成 freshness note：

export function memoryFreshnessNote(mtimeMs: number): string {
const text = memoryFreshnessText(mtimeMs)
if (!text) return ''
return `<system-reminder>${text}</system-reminder>\n`
}

静态 Global Cache 会让昨天的日期、旧文件的 freshness 一直留在上下文里。

---

隐私角度：不同项目/用户/隐私级别的记忆必须隔离

1. Memory 本身就有明确的隐私分层

src/utils/claudemd.ts:1168-1177

const description =
file.type === 'Project'
? ' (project instructions, checked into the codebase)'
: file.type === 'Local'
? " (user's private project instructions, not checked in)"
: feature('TEAMMEM') && file.type === 'TeamMem'
? ' (shared team memory, synced across the organization)'
: file.type === 'AutoMem'
? " (user's auto-memory, persists across conversations)"
: " (user's private global instructions for all projects)"

这五类记忆（Managed / User / Project / Local / Team / AutoMem）隐私边界完全不同：

- Local 是不提交到仓库的私有项目指令
- TeamMem 是组织内共享
- User 是跨项目的个人全局指令

如果把这些放进一个跨项目共享的静态 Global Cache，就相当于把 A 项目的 CLAUDE.local.md 内容也喂给 B 项目，直接破坏隐私隔离。

2. 发现路径是 cwd / git root 相关的，不是全局的

src/utils/claudemd.ts:12-16 说明发现规则：

// Project and Local files are discovered by traversing from the current directory up to root
// Files closer to the current directory have higher priority

CLAUDE.md 的内容取决于当前工作目录。你在 project-a/ 和 project-b/ 下启动 Claude Code，读到的记忆完全不同。静态 Global Cache 没有按 cwd 做 key，就会跨项目串味。

3. 当前实现为什么相对安全

getUserContext 被 memoize 时没有参数，意味着它的隐式 key 就是“当前进程 + 当前 cwd 状态”。这虽然不是最严格的隔离，但至少：

- 进程结束，缓存消失
- 切换目录或项目时，通常伴随新进程或显式 clear
- 不会把 A 用户的 ~/.claude/CLAUDE.md 泄漏给 B 用户

而真正的“静态 Global Cache”（比如模块级 const globalClaudeMdCache = ...）会彻底打破这些边界。

---

★ Insight ─────────────────────────────────────

1. 缓存问题本质是“失效”问题：CLAUDE.md 和 Memory 是活的文件，不是编译期常量。静态 Global Cache 没有失效机制，会导致模型读到过期指令、旧日期、错误记忆。源码通过 memoize + 多处 cache.clear() 来平衡性能与新鲜度。
2. 隐私问题本质是“作用域”问题：Memory 按 Managed → User → Project → Local → Team 分层，且发现路径依赖 cwd。静态 Global Cache 默认跨项目/跨用户共享，会直接把一个项目的私有指令泄漏到另一个项目。
3. “Global” 不等于 “Process-wide”：当前 getUserContext 的缓存是进程级的、可失效的、隐式绑定当前 cwd 的；而一个“常驻静态 Global Cache”通常意味着跨进程、不可失效、无作用域 key，这正是源码刻意避免的
   接下来的问题就是system reminder是怎么进到消息里面的 这里面经历了什么？

```ts
/**
 * Ensure all text content in attachment-origin messages carries the
 * <system-reminder> wrapper. This makes the prefix a reliable discriminator
 * for the post-pass smoosh (smooshSystemReminderSiblings) — no need for every
 * normalizeAttachmentForAPI case to remember to wrap.
 *
 * Idempotent: already-wrapped text is unchanged.
 */
function ensureSystemReminderWrap(msg: UserMessage): UserMessage {
  const content = msg.message.content;
  if (typeof content === "string") {
    if (content.startsWith("<system-reminder>")) return msg;
    return {
      ...msg,
      message: { ...msg.message, content: wrapInSystemReminder(content) },
    };
  }
  let changed = false;
  const newContent = content.map((b) => {
    if (b.type === "text" && !b.text.startsWith("<system-reminder>")) {
      changed = true;
      return { ...b, text: wrapInSystemReminder(b.text) };
    }
    return b;
  });
  return changed ? { ...msg, message: { ...msg.message, content: newContent } } : msg;
}
```

注释说明得很清楚：

▎ Ensure all text content in attachment-origin messages carries the <system-reminder> wrapper. This makes the prefix a reliable discriminator for the post-pass smoosh.

它的作用是统一前缀，这样下游的 smooshSystemReminderSiblings 只要看到 startsWith('<system-reminder>') 就知道这是系统提醒内容，可以安全折叠。

这段逻辑在 normalizeMessagesForAPI 处理 attachment case 时调用（src/utils/messages.ts:2273-2276），受 feature gate tengu_chair_sermon 控制。

合并后产生 siblings

在 normalizeMessagesForAPI 里，连续的 user message 会被合并：

```ts
const lastMessage = last(result);
if (lastMessage?.type === "user") {
  result[result.length - 1] = mergeUserMessages(lastMessage, normalizedMessage);
  return;
}
```

附件消息本身也是 user message。合并后，原本独立的 system-reminder 文本块会变成同一条 user 消息里的多个 text sibling。

最终整理：把 system-reminder siblings 折叠进 tool_result

```ts
src/utils/messages.ts:1835-1873

function smooshSystemReminderSiblings(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  return messages.map(msg => {
    if (msg.type !== 'user') return msg
    const content = msg.message.content
    if (!Array.isArray(content)) return msg

    const hasToolResult = content.some(b => b.type === 'tool_result')
    if (!hasToolResult) return msg

    const srText: TextBlockParam[] = []
    const kept: ContentBlockParam[] = []
    for (const b of content) {
      if (b.type === 'text' && b.text.startsWith('<system-reminder>')) {
        srText.push(b)
      } else {
        kept.push(b)
      }
    }
    if (srText.length === 0) return msg

    // Smoosh into the LAST tool_result
    const lastTrIdx = kept.findLastIndex(b => b.type === 'tool_result')
    const lastTr = kept[lastTrIdx] as ToolResultBlockParam
    const smooshed = smooshIntoToolResult(lastTr, srText)
    ...
  })
}
```

这是最关键的一步：把所有 <system-reminder> 开头的 text block 折叠进同一条 user 消息里的最后一个 tool_result。

为什么要这么做？

- 如果 system-reminder 文本作为独立 text sibling 留在 user turn 里，模型可能把它当成“用户的补充输入”。
- 把它塞进 tool_result 的 content 里，它就明确归属为“工具结果的上下文/补充说明”，符合 <system-reminder> 的语义。
- 这还能处理一些边界情况，比如 PreToolUse hook additionalContext、relocateToolReferenceSiblings 产生的漏网之鱼。

这段在 normalizeMessagesForAPI 的最后阶段执行（src/utils/messages.ts:2334-2338），同样受 tengu_chair_sermon 控制。

UI 层：给用户看的时候再剥掉

模型看到的是带 <system-reminder> 标签的消息，但用户界面不需要显示这些标签。src/components/messageActions.tsx:399-408：

```ts
export function stripSystemReminders(text: string): string {
  const CLOSE = "</system-reminder>";
  let t = text.trimStart();
  while (t.startsWith("<system-reminder>")) {
    const end = t.indexOf(CLOSE);
    if (end < 0) break;
    t = t.slice(end + CLOSE.length).trimStart();
  }
  return t;
}
```

VirtualMessageList.tsx:157 渲染消息列表时调用它，所以在 REPL 里看不到 <system-reminder> 标签。
★ Insight ─────────────────────────────────────

1. <system-reminder> 不是纯粹的文本标记，而是一种消息结构调度器：它先在生成阶段被包上，再在 API 准备阶段被识别、合并、折叠进 tool_result，最后在 UI 层被剥离。三个阶段各自关心不同的事。
2. smoosh 解决的是“位置语义”问题：system-reminder 内容如果作为独立 user text 存在，模型会误以为这是人类输入；塞进 tool_result 后，它回归为“工具结果附带的系统提示”。
3. feature gate tengu_chair_sermon 控制整条新路径：ensureSystemReminderWrap 和 smooshSystemReminderSiblings 是同一个 gate，说明“统一包标签 + 折叠进 tool_result”是一起上线的一套整理策略。

### 消息规范化

normalizeMessagesForAPI的作用是把 Claude Code 内部丰富的消息类型（包含 attachment、virtual message、progress、system command、tool reference、synthetic error 等）清洗成 Anthropic API 能接受的 user | assistant 消息序列。

```ts
export function normalizeMessagesForAPI(messages, tools = []) {
  const availableToolNames = new Set(tools.map((t) => t.name));
  const reorderedMessages = reorderAttachmentsForAPI(messages).filter((m) => !m.isVirtual);

  const errorToBlockTypes = {
    [getImageTooLargeErrorMessage()]: new Set(["image"]),
    [getRequestTooLargeErrorMessage()]: new Set(["document", "image"]),
  };

  // 遇到大图、大 PDF 等错误后，只剥离对应块，而不是粗暴丢历史
}
```
