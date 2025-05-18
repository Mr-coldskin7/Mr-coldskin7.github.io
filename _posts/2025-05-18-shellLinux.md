---
title: 常见Linux命令和shell脚本
date: 2025-05-18 10:33:00 +0800
categories: [Linux,shell]
tags: [study]
---
# Linux常见命令
## ls
list，用于显示当前目录所有的文件和目录
ls-l 列出所有文件的相关属性
```bash
drwxr-xr-x 4 coldskin7 coldskin7 4096 Jan 15 06:52 Desktop
drwxr-xr-x 2 coldskin7 coldskin7 4096 Dec 17  2023 Documents
drwxr-xr-x 2 coldskin7 coldskin7 4096 Jan 15 18:24 Downloads
-rw-r--r-- 1 coldskin7 coldskin7 8980 Dec 17  2023 examples.desktop
drwxr-xr-x 2 coldskin7 coldskin7 4096 Mar 30  2024 Music
drwxr-xr-x 2 coldskin7 coldskin7 4096 Dec 17  2023 Pictures
drwxr-xr-x 2 coldskin7 coldskin7 4096 Dec 17  2023 Public
drwxr-xr-x 2 coldskin7 coldskin7 4096 Dec 17  2023 Templates
drwxr-xr-x 2 coldskin7 coldskin7 4096 Dec 17  2023 Videos
```
第一位
- `d` 表示这是一个 ​**​目录​**​（directory）
- `-`：普通文件（如文本、脚本）
- `l`：符号链接（快捷方式）
- `b`/`c`：块设备或字符设备（如硬盘、键盘）
后三位代表的是**所有者权限**
-  ​**​读（r）​**​：查看目录内容（如用 `ls` 列出文件）
- ​**​写（w）​**​：添加、删除或重命名目录内文件
- ​**​执行（x）​**​：进入目录（如 `cd` 命令）
   ​**​第5-7位（所属组权限**
   ​**​第8-10位（其他用户权限）**
如果显示的是数字的话
规则为 ​**​r=4，w=2，x=1​**​，每组权限相加后组合成3位数字
这也很好理解，二进制数
0 0 0
r w x
按照这个思路去理解就简单清晰很多
*ls-a* 显示隐藏文件（.开头的）
*ls -la* 就是两者结合起来，列出所有文件（包括隐藏）
## cd
*cd..* 返回上一层目录
*cd dir* 进入dir文件目录（如果当前文件夹有的话）
*cd -* 回到你刚才来的目录
## cat
`cat`（全称 ​**​concatenate​**​）是Linux系统中用于 ​**​查看、拼接、创建或修改文本文件​**​ 的基础工具。其核心功能包括：
- ​**​快速显示文件内容​**​：直接输出到终端，无需分页
- ​**​多文件操作​**​：合并多个文件内容为一个新文件
- ​**​创建/追加文件​**​：通过重定向符 `>` 或 `>>` 生成或修改文件
```bash
cat filename.txt         # 显示单个文件内容[1,6](@ref)
cat file1.txt file2.txt  # 依次显示多个文件内容[3,5](@ref)
```
- `-n`：显示所有行的行号（包含空格）
- `-b`：仅对非空行编号
- `-s`：合并连续空行为单行
- `-E`：在行尾显示 `$` 符号
- `-T`：将制表符显示为 `^I`
合并文件
```bash
cat file1.txt file2.txt > merged.txt  # 合并到新文件[3,6](@ref)
cat *.log >> all_logs.txt             # 追加所有日志文件到现有文件[5,7](@ref)
```
#### **创建与编辑文件​**​

- ​**​创建新文件​**​：
`cat > newfile.txt    # 输入内容后按 Ctrl+D 结束`
- ​**​追加内容​**​：
`cat >> existing.txt  # 向现有文件追加内容`
```bash
coldskin7@ubuntu:~/Desktop$ cat > test.txt
hi Hellobgduiwqgdi7uqwg diuwqguidwqqq
ndqwiidwqnidqwhi
coldskin7@ubuntu:~/Desktop$ cat test.txt
hi Hellobgduiwqgdi7uqwg diuwqguidwqqq
ndqwiidwqnidqwhi
```

## head
```bash
head --lines = n xxx.txt
```
查看一个文件的开头，lines指定多少行
tail同理
```bash
tail --lines = n xxx.txt
```
## less
可以支持你用键盘上下键来阅读文本
```bash
less xxx.txt
```
## 文本编辑器 nano & vim
nano里面更像是一个特殊的界面，底部有相关的操作
vim更加轻量化，相对应的就没那么多提示了
vim中常用的:w：保存；:q：退出；:wq 或 :x：保存并退出；:q!：强制退出不保存
## file
```bash
file [选项] 文件名
```
通过分析文件的​**​魔术数字（Magic Number）​**​和元数据（而非文件扩展名）来判定文件类型
```bash
coldskin7@ubuntu:~/Desktop$ file test.txt
test.txt: ASCII text
```
## find
find用来查看当前目录里面有没有指定文件
```bash
find filename
```
## echo
echo可以打印字符串
```bash
echo "Hello, World!"  # 输出 "Hello, World!"
```
- ​**​覆盖写入文件​**​：
```bash
echo "New content" > file.txt  # 覆盖 file.txt 内容
```

**​追加内容到文件​**​：
```bash
`echo "Appended line" >> file.txt  # 向 file.txt 末尾追加内容`
```
## man
使用man可以查看相关用法
```bash
man command
```
## mv
mv是move，他即使移动也是改名，原理是命名一个指定名字的文件，把原来文件的东西拷贝进去
- **语法​**​：`mv [选项] 源文件/目录 目标文件/目录`
- ​**​核心选项​**​：
    - `-i`：覆盖前询问用户确认（交互模式）
    - `-f`：强制覆盖目标文件，不提示
    - `-b`：覆盖前创建备份文件（备份后缀默认 `~`）
    - `-u`：仅当源文件比目标文件新时执行移动
    - `-t 目录`：指定目标目录，批量移动多个文件（如 `mv file1 file2 -t dir/`）
    - `-v`：显示操作细节（如移动路径）
```bash
mv -i old.txt new.txt       # 重命名文件（若 new.txt 存在则询问）
mv *.log /var/log/          # 移动所有 .log 文件到指定目录
mv -b config.conf backup/   # 覆盖前备份原文件为 config.conf~
```
## rm
- **语法​**​：`rm [选项] 文件/目录`
- ​**​核心选项​**​：
- `-r` 或 `-R`：递归删除目录及其子内容
- `-f`：强制删除，忽略不存在文件或权限问题
- `-i`：删除前逐一确认
- `-d`：删除空目录（等效 `rmdir`）
- `-v`：显示删除过程
```bash
rm -r temp/           # 递归删除目录（慎用！）
rm -i *.bak           # 删除所有 .bak 文件前确认
rm -f /tmp/cache.log  # 强制删除日志文件（不提示）
```
## 简单的Shell脚本
*$* 代表变量
例如
```bash
echo file#输出的是字符串file
echo $file#输出的是变量file
```
 ' * '通配符
```bash
$ for file in test*
> do
> echo $file
> done
test
test1.txt
test2.txt
test.txt
```
’ # ‘ 不仅有注释的意思
还有
变量替换中，`#`用于删除字符串前缀，支持两种模式
1. **最短匹配删除​**​  
    `${var#pattern}`：删除从左起第一个匹配`pattern`的部分。
```bash
    path="/usr/local/bin" echo ${path#*/}  # 输出 "usr/local/bin"（删除首个`/`）
    ```
2. ​**​最长匹配删除​**​  
    `${var##pattern}`：删除从左起最长匹配`pattern`的部分。
    ```bash
    ``path="/usr/local/bin" echo ${path##*/}  # 输出 "bin"（删除最后一个`/`前的所有内容）
    ```
    
