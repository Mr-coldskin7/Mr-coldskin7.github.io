---
title: C++中的Vector
date: 2025-02-24 23:00:00 +0800
categories: [Algorithm, Cpp]
tags: [study]
---
# CPP中的vector
vector 是 C++ 标准库的动态数组，它可以动态地分配内存（不需要事先申明大小），可以方便地管理数组中的元素。
```cpp
#include <vector>

int n = 7, m = 8;

// 初始化一个 int 型的空数组 nums
vector<int> nums;

// 初始化一个大小为 n 的数组 nums，数组中的值默认都为 0
vector<int> nums(n);

// 初始化一个元素为 1, 3, 5 的数组 nums
vector<int> nums{1, 3, 5};

// 初始化一个大小为 n 的数组 nums，其值全都为 2
vector<int> nums(n, 2);

// 初始化一个二维 int 数组 dp
vector<vector<int>> dp;

// 初始化一个大小为 m * n 的布尔数组 dp，
// 其中的值都初始化为 true
vector<vector<bool>> dp(m, vector<bool>(n, true));
```
C++标准库中的vector采用动态扩容机制以支持高效的元素插入操作。
size()：当前存储的元素数量。
capacity()：无需重新分配内存时可容纳的最大元素数量。
当插入元素导致size()超过capacity()时，触发扩容。
扩容则根据编译器的不同而扩张的策略不同，总的来说都是扩展更大的地方，拷贝黏贴更新
常用操作
```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n = 10;
    // 数组大小为 10，元素值都为 0
    vector<int> nums(n);
    // 输出 0 (false)
    cout << nums.empty() << endl;
    // 输出：10
    cout << nums.size() << endl;

    // 在数组尾部插入一个元素 20
    nums.push_back(20);
    // 输出：11
    cout << nums.size() << endl;

    // 得到数组最后一个元素的引用
    // 输出：20
    cout << nums.back() << endl;

    // 删除数组的最后一个元素（无返回值）
    nums.pop_back();
    // 输出：10
    cout << nums.size() << endl;

    // 可以通过方括号直接取值或修改
    nums[0] = 11;
    // 输出：11
    cout << nums[0] << endl;

    // 在索引 3 处插入一个元素 99
    nums.insert(nums.begin() + 3, 99);

    // 删除索引 2 处的元素
    nums.erase(nums.begin() + 2);

    // 交换 nums[0] 和 nums[1]
    swap(nums[0], nums[1]);

    // 遍历数组
    // 0 11 99 0 0 0 0 0 0 0
    for (int i = 0; i < nums.size(); i++) {
        cout << nums[i] << " ";
    }
    cout << endl;
}
```
我觉得其中最重要的几个：
```cpp
vector<vector<int>> vec(n, vector<int>(m));<!--二维数组的初始化-->
vec.size()<!--容器大小-->
vec.empty()<!--判断是否为空-->
vec.push_back(x)<!--在尾部插入元素-->
vec.pop_back()<!--删除尾部元素-->
vec.insert(pos,x)<!--在pos位置插入元素x-->
vec.erase(pos)<!--删除pos位置的元素-->
```
这些对于leetcode的刷题来说是绝对基础的东西，但是我每隔一段时间就会忘了（其实就是写少了）特地写这些来方便以后找
最后顺便带上api的连接：https://en.cppreference.com/w/cpp/container/vector

