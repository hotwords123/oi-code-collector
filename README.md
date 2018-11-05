
# OI-CODE-COLLECTOR

## 简易OI交题服务器

---

### 简介

##### 还在QQ上手忙脚乱地接收模拟赛中选手发来的的代码？
##### 还在一个又一个的文件夹里翻找命名错误的文件？
##### 使用这个交题服务器，只需要简单的几步配置，轻松解决以上问题！

### 搭建方法

1. 当然是先把项目clone到自己电脑上
2. 把`options-example.json`复制一份，命名为`options.json`
3. 在项目文件夹下，用命令`npm install`安装所需的模块
4. 在项目文件夹下，用命令`node app.js`或`npm start`启动服务器
5. 在浏览器地址栏输入`localhost`回车，如果您看到了欢迎界面，恭喜您，服务器已搭建完成！

#### 如果搭建不成功，可能有以下原因：

1. **模块没有安装成功。** 解决方法：尝试重新执行第3步。
2. **80端口被占用。** 解决方法：打开`options.json`，找到`port`字段，修改为一个没有被占用的端口号(一般大于`4096`即可)。
3. **其它神奇的原因。** 如果您确认(或怀疑)这是一个bug，欢迎`Issues`和`Pull requests`。

### 使用方法

1. 选手页面: `/user`，输入用户名即可登录，然后就可以提交代码。
2. 管理页面：`/admin`，初始密码为`123456`，进入后可以更改各种设置，~~享受权力的快感~~。
3. 选手可以通过在浏览器地址栏输入`${你的IP地址}:${端口号}`来访问交题服务器。(端口号为80可省略)
4. 在`resources`文件夹(或你想得到的其它任何地方)存放题目文件，然后在管理页面中设置`下发文件路径`，选手即可下载。
5. 选手提交的代码默认存放在项目文件夹下的`uploads`目录中，不新建子文件夹。可以在管理页面中更改代码存放方式。

