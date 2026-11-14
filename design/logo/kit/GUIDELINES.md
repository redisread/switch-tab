# Switch Tab · 跳格 S

两段错位的曲线组成 S，表达在最近标签间快速切换。主轮廓沿用用户选定的 B 方案。

## 文件选择
- `masters/symbol.svg`：主标志；`symbol-black.svg` 为纯黑，`symbol-reversed.svg` 为经过轻微减重的白色反转版。
- `masters/horizontal.svg` / `horizontal-reversed.svg`：横向组合；`stacked.svg`：竖向组合；`wordmark.svg`：独立字标。
- `masters/symbol-small.svg`：加宽中间空隙的小尺寸形状。`toolbar-icon.svg` / `chrome-icons/`：实际插件使用的紫底白标。
- `masters/app-icon.svg` / `app-icon-512.png`：较大尺寸应用头像。
- `exports/`：黑白、品牌单色、网页 favicon、ICO、PWA 图标和引用代码。网页资源是可复用套件，不代表已建立 PWA。

## 配色
| 颜色 | HEX | RGB | CMYK 近似参考 |
|---|---|---|---|
| 紫罗兰 | #6355D9 | 99, 85, 217 | 54, 61, 0, 15 |
| 墨黑 | #17191D | 23, 25, 29 | 21, 14, 0, 89 |
| 浅紫背景 | #EEEBFF | 238, 235, 255 | 7, 8, 0, 0 |
| 白色 | #FFFFFF | 255, 255, 255 | 0, 0, 0, 0 |

白色与主紫色的 sRGB 对比度约 5.48:1。浅色底用紫色标志或墨黑字标，深色底用反转版；小尺寸工具栏使用紫色底白色 S，避免随系统主题丢失对比。CMYK 仅作初始参考，印刷需按纸张/ICC 打样；未指定 Pantone 色号。

## 尺寸与留白
- 普通符号最小 24px；16–20px 使用 small/toolbar 版本。横向组合建议至少 160px 宽。
- 符号外侧保留至少 24/256 倍标志画布宽度的空白（等于主标中间空隙）；组合标志四周保留至少半个字标大写高度。
- 标准形状中缝 24 单位，小尺寸版 32 单位。不要自行收窄间隙、拉伸、旋转或拆开两段。
- 不加描边、投影或渐变，不在复杂图片上直接叠放透明标志；使用单色底承载。

## 字体与矢量
字标来自 Manrope variable，字重 650，对 Sw/Ta 间距作光学调整，已全部转换为路径，不依赖本机字体。Manrope 使用 SIL OFL 1.1，许可原文见 `licenses/Manrope-OFL.txt`；未附字体二进制。来源：https://github.com/google/fonts/tree/main/ofl/manrope 。重建脚本位于套件外 `../build_masters.py`，需 fontTools 和原字体。

## 验证与边界
已渲染检查 16/24/32/48/128px PNG、黑白及反转版、横向字标；符号无嵌入位图、滤镜、描边或实时文字。SVG 审计对字标 w 的倾斜角和字形节点数作提示，这是字体原始轮廓，不应为消除提示扭曲文字。PNG 是插件资源，SVG 是可编辑母版。未进行商标权利清查。

展示板中的网站、社交主页、移动设备是应用情境示意，不代表已上线网站、已注册域名或移动应用。
