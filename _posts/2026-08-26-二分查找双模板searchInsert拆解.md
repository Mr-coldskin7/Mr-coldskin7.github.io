---
layout: post
title: 二分查找双模板 + searchInsert 逐行拆解：从模板到边界
date: 2026-08-26 23:00:00 +0800
categories: [LeetCode, Algorithm]
tags: [leetcode, binary-search, template, lower-bound, search-insert]
giscus_comments: true
---

# 二分查找双模板 + searchInsert 逐行拆解：从模板到边界

> 本文由三部分组成：**双模板框架**（找最小 / 找最大）、**searchInsert 逐行拆解**（模板一的最干净应用），以及一个藏在 searchInsert 里的**边界 bug**——它会让「target 大于所有元素」时返回错误答案。

## 一句话理解

**所有二分查找只有两种题型：找「满足条件的最小值」和「满足条件的最大值」。** 各自对应一个 4 行模板。searchInsert 是模板一的应用，但它暴露了一个模板笔记里常见的盲区——**答案域的右边界**。

---

## 一、前提条件：单调性是二分的命根子

二分查找只能用于**单调**的数据：

- 数组必须有序（递增或递减）
- 或者**答案具有单调性**：如果 `x` 满足条件，则 `x+1` 也满足（找最小）；或者 `x` 满足则 `x-1` 也满足（找最大）

没有单调性，二分会漏掉正确答案——这是所有二分题的第一步判断。

### 基础二分 vs 二分答案

| | 基础二分 | 二分答案 |
|--|---------|---------|
| 搜索空间 | 数组索引 `[0, n-1]` | 答案的取值范围（如 `[1, max]`） |
| 比较对象 | `nums[mid]` 和 `target` | `check(mid)` 的结果 |
| 单调性来源 | 数组有序 | `check` 函数具有单调性 |

`nums[mid] >= target` 就是一个「check 函数」，所以 searchInsert 在两种框架下都能理解——它既是在索引里找位置，也是在做「第一个满足 `nums[pos] >= target` 的位置」的二分答案。

---

## 二、双模板框架（背这两个就够）

### 模板一：找满足条件的最小值（最左 / 下界）

```cpp
int left = 最小可能值, right = 最大可能值;

while (left < right) {
    int mid = left + (right - left) / 2;
    if (check(mid)) {
        right = mid;        // 满足条件，答案在左边（含 mid）
    } else {
        left = mid + 1;     // 不满足，答案在右边（不含 mid）
    }
}
return left;  // left == right，就是答案
```

**记忆口诀：满足往左缩，不满足往右跳。**

- 为什么 `right = mid`？mid **满足条件**，它**有可能是最终答案**，不能排除。
- 为什么 `left = mid + 1`？mid **不满足**，它**一定不是答案**，直接排除。

### 模板二：找满足条件的最大值（最右 / 上界）

```cpp
int left = 最小可能值, right = 最大可能值;

while (left < right) {
    int mid = left + (right - left + 1) / 2;  // 注意 +1！
    if (check(mid)) {
        left = mid;         // 满足条件，答案在右边（含 mid）
    } else {
        right = mid - 1;    // 不满足，答案在左边（不含 mid）
    }
}
return left;
```

**记忆口诀：满足往右扩，不满足往左砍。mid 要加一防死锁。**

**为什么模板二的 mid 要 +1？** 假设 `left = 3, right = 4`：
- 不加 1：`mid = 3`，若满足条件则 `left = mid = 3` → **死循环**
- 加 1：`mid = 4`，若满足条件则 `left = 4`，循环正常结束

**防死锁的本质**：模板二用 `left = mid`，为了让区间**必然缩小**，mid 必须偏向右边（上中位数，`(left+right+1)/2`）。模板一用 `right = mid`，同理 mid 必须偏向左边（下中位数，`(left+right)/2`）。**「哪边用 `=` 收边，mid 就往对面偏。」**

---

## 三、`while (left < right)` vs `while (left <= right)`

| 特性 | `left < right` | `left <= right` |
|------|----------------|-----------------|
| 循环结束 | `left == right`（重合） | `left = right + 1`（交叉） |
| 返回值 | `left` 或 `right` 都行 | 必须返回 `left` |
| 分支数 | 2 个（满足/不满足） | 容易写出 3 个分支（多了 `==`） |

**`left <= right` 的交叉现象**（地铁闸机比喻）：循环条件是**进门时**检查的，而 left/right 是在**门里面**被改变的。

```
left = 3, right = 3;
while (left <= right) {   // 3 <= 3？是，进门！
    int mid = 3;
    right = mid - 1;      // right 变成 2，已经交叉了
}                         // 回到门口：3 <= 2？否，挡在门外
```

循环不会在 `right = 2` 的那一瞬间中断——先刷卡进门，在站台里把卡弄丢了，想再进一次时被挡在外面。模板框架选 `left < right`，就是因为「重合即结束、返回 left」这个语义最干净，不用处理交叉后的语义。

---

## 四、searchInsert 逐行拆解（LC 35）

问题：给定递增数组 `nums` 和 `target`，返回它应该被插入的下标（如果存在则返回其下标）。**这定义的正是「第一个 `>= target` 的位置」，即 C++ 的 `std::lower_bound`。**

```cpp
int searchInsert(vector<int>& nums, int target) {
    int left = 0, right = nums.size() - 1;   // ← 有坑，见第五节
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] >= target) {           // check(mid)：满足吗？
            right = mid;                      // 满足 → 往左缩（模板一）
        } else {
            left = mid + 1;                   // 不满足 → 往右跳
        }
    }
    return left;
}
```

**循环不变量：答案一定在 `[left, right]` 内。** 每步保持不变性，直到缩成单点。

### 完整算例：`nums = [1,3,5,6]`, `target = 4`（答案 = 2）

| 轮次 | left | right | mid | nums[mid] | 动作 |
|---|---|---|---|---|---|
| 1 | 0 | 3 | 1 | 3 | `3 >= 4`? 否 → `left = 2`（排除 mid） |
| 2 | 2 | 3 | 2 | 5 | `5 >= 4`? 是 → `right = 2`（保留 mid） |
| 结束 | 2 | 2 | — | — | 返回 2 ✅ |

### 为什么比较符是 `>=` 而不是 `>`：一个条件统一两种语义

| 情况 | `>=` 找到的 | 示例（nums=[1,3,5,6]） |
|---|---|---|
| target 存在 | 第一个 target（重复时最左） | target=5 → 2 |
| target 不存在 | 第一个比 target 大的位置 = 插入点 | target=4 → 2 |

写成 `>` 就会在处理「存在」时跳过正确下标。**searchInsert 的灵魂就是：用「第一个 `>= target`」这一个条件，把「找得到」和「找不到」两种情况统一掉。**

---

## 五、循环不变量：证明三件套（从「背模板」到「懂模板」）

这一节回答一个问题：**凭什么相信这个循环一定对？** 答案是「循环不变量 + 证明三件套」——CLRS《算法导论》证明算法正确性的标准方法，形式上就是 Hoare 逻辑（C.A.R. Hoare, 1969）的 while 循环规则。

### 什么是循环不变量

**循环不变量（loop invariant）= 一条「每次进入循环时都必然为真」的命题。** 「不变」不是说 left/right 不变——它们每轮都在变；不变量描述的是**循环走到这一步，算法已经确定了什么**。

对 searchInsert，不变量是：

> **答案一定在 `[left, right]` 内（right 含）。**

### 为什么三件套就够：因为它是归纳法

三个步骤恰好对应数学归纳法的三块：

| 证明三件套 | 归纳法对应 | 内容 | 直觉 |
|---|---|---|---|
| ① 初始成立 | 基础步 | 循环开始前，不变量成立 | 能推倒第一张多米诺 |
| ② 保持 | 归纳步 | 某轮开始前成立 ⟹ 这轮结束后仍成立 | 每张牌都会推倒下一张 |
| ③ 终止 | 收尾 | 循环必然结束；结束时不变量 + 退出条件 ⟹ 答案正确 | 最后一张牌倒下后拿到答案 |

①② 合起来就是归纳法：**任意执行了 k 轮之后，不变量都成立。** ③ 是单独的一步——循环若不终止，①② 只证明「已执行的轮次都对」，但你永远得不到答案。

### 更强的双栅栏不变量：为什么必须有序

只用「答案 ∈ [left, right]」足够证明正确，但不够解释「为什么」。换成**双栅栏不变量**，答案一目了然：

> **左栅栏**：所有 `i < left` 的元素都 `< target`（太小，已确定不是答案）  
> **右栅栏**：所有 `i ≥ right` 的元素都 `≥ target`（够大，答案不可能超过 right）

验证「保持」——注意每一步都**必须用到数组递增**：

| 分支 | 对新区间的论证 | 另一侧栅栏 |
|---|---|---|
| `nums[mid] ≥ target` → `right = mid` | `nums[mid] ≥ target` + 递增 ⟹ **mid 之后全 `≥ target`**，右栅栏建立 | 左栅栏没动，仍成立 |
| `nums[mid] < target` → `left = mid+1` | `nums[mid] < target` + 递增 ⟹ **mid 及之前全 `< target`**，左栅栏扩展覆盖 mid | 右栅栏没动，仍成立 |

**这就是「必须有序」的根源**：没有递增性，你无法从「`nums[mid] ≥ target`」推出「mid 后面全都 ≥ target」，两个栅栏当场塌掉。**单调性不是二分的「使用条件」，而是这个证明的燃料。**

验证「初始成立」也顺带成立：左栅栏 `∀i < 0`、右栅栏 `∀i ≥ n` 都是空集，恒真。

### ③ 终止：两个证据

1. **循环必然结束**：每轮区间长度 `right - left` 严格减小——分支 1 使 `right = mid < right`，分支 2 使 `left = mid+1 > left`。长度是正整数，不可能无限减小。这同时解释了模板二为什么死循环：`left = mid` 时 left 可能原地踏步。
2. **结束时答案正确**：退出时 `left == right = L`，不变量说答案 ∈ [left, right] = {L} ⟹ **答案就是 L**。

### 三件套的实战用法：抓 bug 的位置

版本 A（`right = n-1`）**死在 ① 初始成立**：它的右栅栏要求「`∀i ≥ n-1` 的元素 `≥ target`」，而当 `target > nums[n-1]` 时这是假命题——不变量「出生即死」，之后怎么缩区间都救不回来。**这就是为什么必须 `right = n`：不是题型特殊，而是让第 ① 步能成立。**

### 这个框架不止二分

任意循环都能用同一套证明。最简单的例子——

```cpp
int sum = 0;
for (int i = 0; i < n; i++) sum += a[i];
```

- ① 初始：0 次迭代后 `sum = 0` = 空和 ✅
- ② 保持：k 轮后 `sum = a[0]+…+a[k-1]`；第 k+1 轮加上 `a[k]` ✅
- ③ 终止：n 轮后 `sum = a[0]+…+a[n-1]`，`i = n` 退出 ✅

滑动窗口的 `[left, right)` 记法、这里的 `[left, right]` 不变量，都是同一套纪律：**先定义「区间里是什么」，再让每一步维护它。**

---

## 六、⚠️ 隐藏边界 bug：target 大于所有元素

**问题出在 `right = nums.size() - 1`。**

这个问题的答案域是 **`[0, n]`**——target 可能插在数组最后面（下标 n）。但 `right = n-1` 把答案域错误地限制成了 `[0, n-1]`。

验证：`nums = [1,3,5,6]`, `target = 7`

```
left=0, right=3 → mid=1 → 3>=7? 否 → left=2
mid=2 → 5>=7? 否 → left=3
left==right==3 → 返回 3  ❌（正确答案是 4）
```

`nums=[1]`, `target=5` 同理：返回 0，正确答案 1。

**根因**：模板笔记里模板一的 right 是「答案的最大可能值」，而这里最大可能值是 **n** 不是 n-1。这属于「**right 初始值设错**」——速查表里常见错误的「left 初始值设错」的对偶版本。

### 修复 A（标准做法，`std::lower_bound` 的姿势）：半开区间

```cpp
int searchInsert(vector<int>& nums, int target) {
    int left = 0, right = nums.size();   // 关键：right 可以等于 n
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] >= target) right = mid;
        else left = mid + 1;
    }
    return left;   // left == right，范围 [0, n]，全对
}
```

### 修复 B（保住原代码，末尾补一行）

```cpp
int left = 0, right = nums.size() - 1;
while (left < right) { /* 原逻辑不变 */ }
return (left < nums.size() && nums[left] >= target) ? left : left + 1;
```

### 为什么标准库坚持半开区间 `[first, last)`？

**「插入位置」的语义天然属于半开区间——它可以是 last（尾部）。** 闭区间 `[0, n-1]` 把「插到结尾」这种可能性掐死了。这是除了「`<` vs `<=`」之外二分的第三个维度：**区间开闭性，以及它和答案域的关系。** 判断方法：**先想清楚答案的取值范围（含不含端点），再决定 left/right 的初值和区间的开闭。**

---

## 七、经典二分答案题套用

### 1. Koko Eating Bananas（LC 875）——找最小速度

```cpp
int minEatingSpeed(vector<int>& piles, int h) {
    int left = 1;                                  // 速度至少 1
    int right = *max_element(piles.begin(), piles.end());
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (f(piles, mid) <= h) right = mid;       // 能吃完 → 试试更慢
        else left = mid + 1;                       // 吃不完 → 必须更快
    }
    return left;
}
long f(vector<int>& piles, int x) {                // 向上取整求耗时
    long hours = 0;
    for (int p : piles) hours += (p + x - 1) / x;
    return hours;
}
```

**常见错误**：`left` 从 1 开始（速度至少 1）；`f(mid) < h` 和 `f(mid) == h` 拆成两分支会写反——**只要 `<= h` 就统一 `right = mid`**。

### 2. Capacity To Ship Packages（LC 1011）——找最小运载量

```cpp
int shipWithinDays(vector<int>& weights, int days) {
    int left = *max_element(weights.begin(), weights.end());  // 必须 ≥ 最重包裹
    int right = accumulate(weights.begin(), weights.end(), 0);
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (f(weights, mid) <= days) right = mid;   // 天数够 → 试试更小船
        else left = mid + 1;
    }
    return left;
}
int f(vector<int>& weights, int cap) {              // 贪心：算需要几天
    int dayCount = 0;
    for (int i = 0; i < weights.size(); ) {
        int remain = cap;
        while (i < weights.size() && remain >= weights[i]) { remain -= weights[i]; i++; }
        dayCount++;
    }
    return dayCount;
}
```

**常见错误**：`left` 必须是 `max(weights)` 不能是 1——运载量小于单个包裹时 `f` 里的 `i` 不前进，**死循环**。

### 3. Split Array Largest Sum（LC 410）——答案不在数组里

```cpp
int splitArray(vector<int>& nums, int k) {
    int left = 0, right = 0;
    for (int x : nums) { left = max(left, x); right += x; }
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (f(nums, mid) <= k) right = mid;
        else left = mid + 1;
    }
    return left;
}
int f(vector<int>& nums, int x) {                   // 贪心：每段和 ≤ x 时最少几段
    int segments = 1; long sum = 0;
    for (int num : nums) {
        if (sum + num > x) { segments++; sum = num; }
        else sum += num;
    }
    return segments;
}
```

**注意**：答案 `mid` **不一定**是数组中的任何元素或子数组和，它只是一个抽象的整数阈值。单调性来自验证函数本身：如果 `x=18` 能搞定（段数 `<= k`），那么 `x=19,20...` 也一定能搞定。

**三题的共同模式**：`check(mid) <= 限制` → `right = mid`（找最小）。换个角度，这三题都是对**同一句问题**的变体：「在最小可行值处，模拟能否达标」——这是二分答案题的通用模板。

---

## 八、做题流程

1. **判断单调性**：有序数组，或答案随参数单调。
2. **找最小还是找最大** → 选模板一还是模板二。
3. **确定答案域**：想清楚 `left`/`right` 的初值含不含端点（**这步最容易被坑**，searchInsert 就是例子）。
4. **写 `check(mid)`**：满足条件返回 true。
5. **套模板**（注意模板二 mid 的 `+1`）。

## 九、常见错误速查表

| 错误 | 原因 | 修正 |
|------|------|------|
| 数组无序就二分 | 前提是有序/单调 | 先排序或确认单调性 |
| `left` 初始值设错 | 答案有下界约束（运载量 ≥ max weight） | `left = max_element(...)` |
| `right` 初始值设错 | 答案域上限算错（插入位置可到 n） | `right = n`（半开区间） |
| `==` 分支单独处理 | 把 `<=` 拆成 `<` 和 `==` 两个分支，逻辑写反 | 合并成 `<=`，统一 `right = mid` |
| 找最大值忘给 mid 加 1 | `left = mid` 导致死循环 | `mid = (left + right + 1) / 2` |
| 把 `f(mid)` 和 `mid` 搞混 | 时间是速度的反函数，方向反了 | 时间超 → 要更快/更大；时间够 → 慢/小 |
| 认为答案必须在数组里 | 二分答案是在整数范围找阈值 | 答案可以是任意整数（410 题） |

---

## 一句话总结

> **两个模板**：找最小 → 满足 `check(mid)` 就 `right = mid`，不满足就 `left = mid + 1`；找最大 → 满足就 `left = mid`，不满足就 `right = mid - 1`，**mid 记得 `+1`**。  
> **三个维度**：`<` vs `<=`（重合 vs 交叉）、区间开闭（含不含端点）、模板选择（哪边用 `=`，mid 就往对面偏）。  
> **一道题**：searchInsert = 模板一 + `check = nums[mid] >= target` + **`right` 初始化为 `n`**。