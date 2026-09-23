# mix 素材说明

`Old School 90s`——一段 ~2 小时的 90 年代西海岸嘻哈/GFunk 混音（audio-only，AAC）。
文件按 ASCII 规范化为 `old-school-90s.mkv`（音频源，无视频流），原始标题映射如下：

| 文件 | 原始标题 |
|------|----------|
| audios/old-school-90s.mkv | Old School 90s🔥Eminem&SnoopDogg,Tyga,50Cent,DrDree,IceCube,Juicy,Drake-Cover |

布局：本目录为**输入（input）层**，素材只读、永不进入 git。素材在 `audios/`（纯音频源）。
对应的规格（操作层）在 `media/work/mix/`（`split/<单元>/tracklist.json`），产物（输出层）默认落
`media/output/mix/`（ADR-0009 三段式布局）。

约定：素材内容只读，永不转码、永不裁剪原文件；文件名保持 ASCII。

> 注：本素材实为**音频**（ffprobe 实测无 video stream，仅 AAC），`.mkv` 仅是容器扩展名。
> 切分走 `re1999 split` 管线（stream copy，产物 `.m4a`）。
