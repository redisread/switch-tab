# Switch Tab 设计讨论

## 已确认

- 首版支持 macOS Chrome。
- 按最近使用顺序切换；A → B → C 后首次选择 B。
- 期望按住修饰键循环选择，松开后确认；具体键位与可靠性方案待确认。
- 范围限于当前窗口仍打开的标签，不跨窗口，不恢复已关闭标签。
- 默认 Option+Q，允许修改；按住 Option 重复 Q 循环，松开确认，Enter 兜底。
- 普通网页显示居中浮层；受限页面通过工具栏弹窗切换。接受浮层所需网站访问权限。
- 展示最近 5 个标签的网站图标、标题、域名；首版不提供截图、搜索或关闭标签。
- Shift 反向循环、Esc 取消、点击候选确认、失焦取消。
- 选择期间仅移动高亮，不激活标签；候选顺序在一次切换会话中保持固定。
- 快速轻按直接返回上一标签，持续按住约 150ms 才显示面板；时序需要实测。
- 最多展示 5 个其他标签，排除当前标签；默认高亮最近使用的其他标签，循环选择。
- 当前窗口只有一个标签时不切换。
- 首版不支持无痕窗口。

## 最终方案待整体确认

- 首版要求 Chrome 127+，以支持普通安装扩展调用工具栏弹窗。
- 首次安装和浏览器重启后，以 Chrome 提供的 lastAccessed 建立初始顺序；后续跟踪激活事件。时间相同或缺失时以标签栏顺序稳定排序，不宣称能精确还原重启前顺序。
- 默认 Option+Q 优先保证松键体验；自定义为不含 Option 的组合时使用 Enter 或点击确认，首版不泛化所有修饰键释放语义。
- 没有观察到释放事件时，不靠超时猜测确认；保留面板等待 Enter 或点击。受限页面工具栏弹窗以 Enter 或点击确认为可靠路径。
- 数据仅在本机处理，不设置账户、服务端或遥测，不保存网页正文或截图。

## 实现前技术验证

- 先验证 commands 与网页键盘事件配合，覆盖快速轻按、持续循环、Shift 反向、输入框焦点和失焦取消。
- 尽早监听释放事件，避免等待服务工作线程或界面加载时丢失快速轻按操作。
- 若验证无法满足已确认核心体验，反馈具体限制后重新讨论；不静默替换交互。
- 完成代码后创建子代理审查；通过后创建 PR，再依据审查风险决定自动合并或请求人类审查。当前目录尚无 Git 仓库或远程地址，后续核实仓库归属。

## 已核实的约束

- Chrome commands 支持的快捷键不含 Tab，不能承诺覆盖原生 Control+Tab。
- commands 仅提供命令触发事件，松键确认需要界面键盘事件及实际验证。
- 页面浮层无法注入 chrome:// 等受限页面；工具栏 popup 可提供独立入口。

参考：[commands](https://developer.chrome.com/docs/extensions/reference/api/commands)、[action](https://developer.chrome.com/docs/extensions/reference/api/action)、[popup](https://developer.chrome.com/docs/extensions/develop/ui/add-popup)。

补充：[tabs.lastAccessed](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage)、[无痕模式](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)。
