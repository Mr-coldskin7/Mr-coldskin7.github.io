---
title: 用C++实现内存池1
date: 2025-04-20 14:22:00 +0800
categories: [Cpp,memory]
tags: [study]
---
## 内存池
内存池(Memory Pool)是一种内存分配方式。通常我们习惯直接使用new、malloc等API申请分配内存，这样做的缺点在于：由于所申请内存块的大小不定，当频繁使用时会造成大量的内存碎片并进而降低性能。

内存池则是在真正使用内存之前，先申请分配一定数量的、大小相等(一般情况下)的内存块留作备用。当有新的内存需求时，就从内存池中分出一部分内存块，若内存块不够再继续申请新的内存。这样做的一个显著优点是尽量避免了内存碎片，使得内存分配效率得到提升。

### 一、什么是内存池
#### 1.1池化技术
池化技术在计算机视觉中很常见，一般是最大池化或者是平均池化，这么做一般作用是在保留图像或特征图中最显著信息的同时减少数据量，从而提高计算效率并防止过拟合。

其内涵在于：将程序中需要经常使用的核心资源先申请出来，放到一个池内，有程序自管理，这样可以提高资源的利用率，也可以保证本程序占有的资源数量，经常使用的池化技术包括内存池，线程池，和连接池等，其中尤以内存池和线程池使用最多。

#### 1.2内存池
内存池是一种用于管理和分配内存的技术，它通过预先申请一块固定大小的内存空间，并将其划分为多个小块，提供给程序按需分配和释放。
初始化阶段：在程序启动时，内存池会申请一块连续的大块内存空间。
##### 工作原理
分配阶段：当程序需要申请内存时，内存池会从已经分配好的空闲块中找到合适大小的小块来分配给程序。
释放阶段：当程序不再需要某个内存块时，可以将其返回给内存池进行复用。
扩展阶段：如果当前内存池中没有足够的可用空间了，可以根据需要扩展内存池的大小。

##### 优势：
减少碎片化：由于内存池事先划分好了固定大小的小块，避免了频繁的系统调用和堆碎片产生。
提高性能：由于减少了对系统调用和堆管理操作的依赖，提高了程序运行效率。

#### 为什么需要内存池呢
减少内存分配和释放的开销：传统的动态内存分配（如malloc、free）会涉及到操作系统的系统调用，这样会产生较大的开销。而使用内存池可以预先分配一块连续的内存空间，并在需要时直接从中取出或回收，避免频繁进行系统调用，从而提高了程序性能。

减少内存碎片：频繁地进行动态内存分配和释放容易导致堆中产生碎片化的空间。而使用内存池可以固定大小的块来管理内存，避免了不同大小的对象交错排布在堆上导致的碎片问题。

提高缓存命中率：将对象预先分配到连续的块中，可以利用局部性原理提高缓存命中率。相邻对象在物理上也相邻，利于CPU缓存预取等优化。

内存碎片：就像操作系统里提及到的，指已分配的内存空间中存在的一些零散、不连续的小块未被使用的内存。这会导致内存利用率下降，可能影响程序的性能和稳定性。造成堆利用率很低的一个主要原因就是内存碎片化。如果有未使用的存储器，但是这块存储器不能用来满足分配的请求，这时候就会产生内存碎片化问题。

### 内存池设计
首先我们需要先设计内存块
首先内存块里面得要自己可以
```c++
# include <iostream>
using namespace std;

struct MemoryBlock {
    MemoryBlock* next;
    int size;
    int free;
    int free_ptr;
    char adata[1];
};
//adata 并不是直接“记录”结构块末尾的位置，而是通过​​内存分配技巧​​和​​指针计算​​
//adata 的声明​​：虽然 adata 被声明为 char adata[1]（仅 1 字节）
//但通过 malloc 分配时，实际分配的内存远大于结构体本身的大小，因此 adata 的地址可以“越界”访问到后续的动态内存。
```
结构体与动态内存连续​​：adata 的地址是结构体末尾的地址，通过一次性分配内存，使得结构体头部和动态内存区域在物理上是连续的。
可以这样申请内存：
```c++
MemoryBlock* block = (MemoryBlock*)malloc(sizeof(MemoryBlock) + 1024);
```
这里的block指针指向的是结构体之后1开始分配内存时候的地址
桑婆：
```c++
# include <iostream>
using namespace std;

struct MemoryBlock {
    MemoryBlock* next;
    int size;
    int free;
    int free_ptr;
    char adata[];
};
//adata 并不是直接“记录”结构块末尾的位置，而是通过​​内存分配技巧​​和​​指针计算​​
//adata 的声明​​：虽然 adata 被声明为 char adata[1]（仅 1 字节），但通过 malloc 分配时，实际分配的内存远大于结构体本身的大小，因此 adata 的地址可以“越界”访问到后续的动态内存。
int main() {
    MemoryBlock* block = (MemoryBlock*)malloc(sizeof(MemoryBlock) + 1024);
    cout<<"success"<<endl;
    cout<<block->adata<<endl;
    return 0;
}
```
从 adata 开始的区域为内存块用于存储数据元素的空间，这里将它称为数据空间。该数据空间以数据的大小 nunitsize 划分为存储单位，每个存储单位可以存储一个数据。为了对尚未被分配使用的空闲单位进行识别，需要对他们编织序号。在内存块初始化时要编制序号，当内存块被被释放回内存池时也要为他们编制序号，总之内存池管理系统是按照序号来识别和管理空闲存储单位的，至于那些被应用程序占用的单位，则其序号自然消失和失效，直至被程序释放回内存时再由回收函数重新为其编号。

### memory_pool
它用于管理一个​​自定义内存池​​，通过链表组织多个内存块（memoryblock），实现高效的内存分配和回收。
用链表的方式进行组织
```c++
struct MemoryPool {
    int init_size;//第一块大小
    int unit_size;//每个存储单位的大小
    MemoryBlock* head;//头指针
    int grow_size;//每次扩容的大小
};
```
IMO,我觉得这里的Memorypool给memory_block规范了一些标注，例如增长大小等
```cpp
# include <iostream>
using namespace std;

struct MemoryBlock {
    MemoryBlock* next;
    int size;
    int free;
    int free_ptr;
    char adata[];
};
struct MemoryPool {
    int init_size;//第一块大小
    int unit_size;//每个存储单位的大小
    MemoryBlock* head;//头指针
    int grow_size;//每次扩容的大小
};
//adata 并不是直接“记录”结构块末尾的位置，而是通过​​内存分配技巧​​和​​指针计算​​
//adata 的声明​​：虽然 adata 被声明为 char adata[1]（仅 1 字节），但通过 malloc 分配时，实际分配的内存远大于结构体本身的大小，因此 adata 的地址可以“越界”访问到后续的动态内存。
int main() {
    MemoryPool pool;
    MemoryBlock* block = (MemoryBlock*)malloc(sizeof(MemoryBlock) + 1024);
    block->size = 1024;
    block->free = 1024;
    block->free_ptr = 0;
    block->next = NULL;
    pool.head = block;
    cout<<pool.head<<endl;
    pool.init_size = 1024;
    pool.unit_size = 1;
    pool.grow_size = 512;
    MemoryBlock* new_block = (MemoryBlock*)malloc(sizeof(MemoryBlock) + 512);
    MemoryBlock* temp = (MemoryBlock*)malloc(sizeof(MemoryBlock) + pool.grow_size);
    cout<<temp<<endl;
    return 0;

}
```
今天不够时间看后面的构造函数，先写到这里