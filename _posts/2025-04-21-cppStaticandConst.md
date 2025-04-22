---
title: C++中的static和const 1
date: 2025-04-21 11:18:00 +0800
categories: [Cpp,fundumentals]
tags: [study]
---
## C++中的static和const
在 C++ 中，const 和 static 是两个重要的关键字，它们可以修饰变量、函数和类成员，影响其存储方式、作用域和链接性。
二者都有不变性，这是让人困扰的地方

简单来说，他们之间的区别用这样一张表格理解
| 特性               | `const`                          | `static`                         |
|--------------------|----------------------------------|----------------------------------|
| **作用**           | 定义常量，防止修改               | 控制存储期、作用域和链接性       |
| **变量修改**       |  不可修改                      |  可以修改（除非同时是 `const`） |
| **存储位置**       | 取决于作用域（栈/全局区）        | 全局数据区（整个程序生命周期）    |
| **链接性（全局）** | 默认内部链接（C++）              | 修饰全局变量/函数时是内部链接    |
| **类成员**         | `const` 成员必须初始化           | `static` 成员必须在类外定义      |

const强调的是数据的不变性，而static强调的是存在的周期
static在编译器一执行的时候就开始分配内存，并且​​生命周期是整个程序运行期间​​（从初始化开始到程序结束），执行后​​持久存在​​，直到程序结束。
他的不变性是指​​存储位置固定​​（在全局数据区），且​​生命周期与程序相同​​。

```cpp
void foo() {
    static int count = 0;  // 初始化仅发生一次
    count++;
    std::cout << count;    // 每次调用 foo()，count 会递增
}
```
如果是类里面的话
```cpp
class MyClass {
public:
    static int s_count;  // 静态成员变量，属于类而非对象
    static void print() {  // 静态成员函数，不能访问非静态成员
        std::cout << s_count << std::endl;
    }
};
int MyClass::s_count = 0;  // 必须在类外定义
```
这里面的s_count就不是属于对象的了而是类本身具有的特性
而静态成员函数不能访问非静态的成员
```cpp
#include <iostream>
using namespace std;

class MyClass {
    public:
        int value;    
        static int s_count;  // 静态成员变量，属于类而非对象
        static void print() {  // 静态成员函数，不能访问非静态成员
            std::cout << s_count << std::endl;
        }
    };

int MyClass::s_count = 0;

int main(){
    MyClass::print();
    MyClass new_obj;
    new_obj.value = 10;
    new_obj.s_count = 100;
    MyClass::print();
    new_obj.print();
    return 0;
}
```
输出结构
>0
>100
>100

可以看到，对象可以访问是同对应的static函数以及变量，同时也可以进行修改，这是类本身具有的特性，一改的话类里面的也会跟着改变
