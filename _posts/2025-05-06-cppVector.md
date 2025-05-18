---
title: C++ Vector
date: 2025-05-06 10:22:00 +0800
categories: [Cpp,vector]
tags: [study]
---
C++ 中的 `std::vector<std::string>` 是标准模板库（STL）的动态数组容器，其底层实现和模板机制涉及内存管理、类型泛化等核心设计。
```cpp
::std::vector<::std::string ::>
```
Demo
```cpp
#include <iostream>

#include <vector>

using namespace std;

  

int main(){

    vector<int> array;

    array.push_back(1);

    array.push_back(2);

    array.push_back(3);

    array.push_back(4);

    array.push_back(5);

    cout<<array[0];

    cout<<array.size();

    array.pop_back();

    for(int i =0;i<array.size();i++)

    {

        cout<<array[i]<<endl;

    }

    array.insert(array.begin()+2,3);

    for(int i =0;i<array.size();i++)

    {

        cout<<array[i]<<endl;

    }

    array.erase(array.begin()+2);

    for(int i =0;i<array.size();i++)

    {

        cout<<array[i]<<endl;

    }

    return 0;

}
```
vector的用法还是比较简单的，无非就是增删，在哪里加，在哪里删
vector作为一个容器，需要配套迭代器 于是
```cpp
.begin()
.end()
```
因为其支持迭代器，所以常见迭代器的用法例如
可以使用如下来进行循环
```cpp
for (const auto& str : vec) {
    // 循环体
}
```
这么写的好处第一点是const定义的常量，不可以被修改
若不需要修改元素，应使用 `const` 修饰以确保安全性
自动腿法哦类型auto可以不用写类型
使用引用传递&避免拷贝容器元素

`.sort()`和`.find()`这两个用法
**vector.emplace_back()**
**emplace_back**与**push_back**的主要区别在于它们的实现机制。**push_back**在向vector尾部添加元素时，会先创建一个元素，然后将其拷贝或移动到容器中。如果是拷贝操作，之后会自动销毁创建的临时元素。而**emplace_back**则是直接在容器尾部创建元素，省去了这个中间步骤。

就十分合理了
```cpp
.allocator()//用于标记内存池（从谁那里借了内存？）便于之后归还
.data()//获得第一个元素的指针
.size()//已经存了的元素的大小
.capacity()//规划的大小
```
- **`_start`​**​：指向动态内存块的起始位置（即首元素地址）。
- ​**​`_finish`​**​：指向最后一个有效元素的下一个位置（`size = _finish - _start`）。
- ​**​`_end_of_storage`​**​：指向当前分配内存的末尾（`capacity = _end_of_storage - _start`）
这种设计支持 ​**​O(1)​**​ 时间复杂度的随机访问，且对 CPU 缓存友好
- **`std::vector`**是**类模板​**​，通过模板参数 `T` 支持存储任意类型
# 具体的实现
定义
```cpp
// 模板类 vector，使用 alloc 作为默认的空间配置器
template <class T, class Alloc = alloc> 
class vector {
public:
    // (1) 定义迭代器特征所需的五种类型 (符合STL规范)
    typedef T           value_type;         // 元素类型
    typedef value_type* pointer;            // 指针类型
    typedef const value_type* const_pointer; 
    typedef const value_type* const_iterator;
    typedef value_type& reference;          // 引用类型
    typedef const value_type& const_reference;
    typedef size_t      size_type;          // 容器大小类型
    typedef ptrdiff_t   difference_type;    // 迭代器距离类型
    
    // 原生指针即可满足随机访问迭代器需求（因vector使用连续内存）
    typedef value_type* iterator;

    // 空间配置器（封装内存分配/释放操作）
    typedef simple_alloc<value_type, Alloc> data_allocator;

    // 核心指针成员 (三指针管理内存)
    iterator start;          // 指向数据起始位置
    iterator finish;         // 指向最后一个元素的下一个位置
    iterator end_of_storage; // 指向内存空间的末尾

    // 默认构造函数初始化空容器
    vector() : start(0), finish(0), end_of_storage(0) {}

    // 获取迭代器范围
    iterator begin() { return start; }
    iterator end()   { return finish; }

    /******************** 关键成员函数实现 ********************/

    // 插入辅助函数（核心扩容逻辑）
    template <class T, class Alloc>
    void vector<T, Alloc>::insert_aux(iterator position, const T& x) {
        if (finish != end_of_storage) {  // Case 1: 存在备用空间
            // 在备用空间尾部构造一个元素（使用最后一个元素的副本）
            construct(finish, *(finish - 1));
            ++finish;  // 调整水位

            T x_copy = x;  // 防止x在后续操作中被修改
            // 将position之后元素后移（使用逆向拷贝避免覆盖）
            copy_backward(position, finish - 2, finish - 1);
            *position = x_copy;  // 插入新元素
        } 
        else {  // Case 2: 需要扩容
            const size_type old_size = size();
            // 扩容策略：原大小为0则分配1，否则双倍扩容
            const size_type len = old_size != 0 ? 2 * old_size : 1;
            
            iterator new_start = data_allocator::allocate(len);  // 申请新内存
            iterator new_finish = new_start;
            try {
                // 分三段拷贝数据：
                // 1. 原容器position前的元素
                new_finish = uninitialized_copy(start, position, new_start);
                // 2. 插入新元素x
                construct(new_finish, x);
                ++new_finish;
                // 3. 原容器position后的元素
                new_finish = uninitialized_copy(position, finish, new_finish);
            } 
            catch (...) {  // 异常安全处理 (RAII)
                // 回滚：销毁已构造元素并释放内存
                destroy(new_start, new_finish);
                data_allocator::deallocate(new_start, len);
                throw;  // 重新抛出异常
            }

            // 销毁旧元素并释放旧内存
            destroy(begin(), end());
            deallocate();

            // 更新指针指向新内存区
            start = new_start;
            finish = new_finish;
            end_of_storage = new_start + len;
        }
    }

    // 尾部插入元素
    void push_back(const T& x) {
        if (finish != end_of_storage) {  // 直接使用备用空间
            construct(finish, x);  // placement new构造对象
            ++finish;               // 调整水位
        }
        else {  // 触发扩容
            insert_aux(end(), x);   // 调用辅助函数
        }
    }

    // 尾部删除元素
    void pop_back() {
        --finish;            // 前移结束指针
        destroy(finish);     // 调用析构函数
    }

    // 删除指定位置元素
    iterator erase(iterator position) {
        if (position + 1 != end()) {  
            // 将position后元素前移覆盖（普通拷贝）
            copy(position + 1, finish, position);
        }
        --finish;            // 调整水位
        destroy(finish);     // 销毁末尾冗余元素
        return position;     // 返回新的position位置（注意：此时position内容已被覆盖）
    }
};

```


