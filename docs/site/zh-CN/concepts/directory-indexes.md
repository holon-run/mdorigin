---
title: 目录索引
order: 20
date: 2026-03-20
summary: 在 index.md 或 README.md 内生成并维护目录索引块。
---

# 目录索引

使用 `index.md`、`README.md` 或 `SKILL.md` 作为目录页面、智能体可读的索引以及目录的本地清单。

`mdorigin build index` 管理以下标记之间的块：

```md
<!-- INDEX:START -->
<!-- INDEX:END -->
```

如果标记不存在，工具会把它追加到所选目录索引文件的末尾。

受管块只包含内容，不再插入诸如 `Directories` 或 `Articles` 的标题。

`build index` 在内部仍保持这些类别区分：

- 目录排在前面
- 文章排在目录之后
- 目录首页 frontmatter 可用 `type: page` 或 `type: post` 覆盖默认推断

当目录包含 `SKILL.md` 时，除非 frontmatter 显式设置 `type: page`，`mdorigin` 默认把它当作文章包。

被视为 `type: post` 的目录会被 `build index` 跳过。

- `mdorigin` 不会向文章包（如 `post/README.md`）注入受管索引块
- 当文章包只包含首页 markdown 加同目录资源时，这保持了它的干净
- 同一规则适用于技能包（如 `skill-name/SKILL.md`）

对技能包，`build index` 还把常见辅助目录视为非内容支撑文件：

- `scripts/`
- `references/`
- `assets/`
- `templates/`

这些目录仍可作为文件直接访问，但不会为了自动内容索引而递归进入。

当技能目录通过目录符号链接进入发布树时，行为完全相同。

如果某个目录没有可生成的条目，受管块保持为空，而不是输出占位文本。

对根首页，当相同的 `page` 条目已经出现在顶部导航时，HTML 渲染可以隐藏这些重复条目。原始 markdown 保持不变。

当页面包含受管索引块时，默认 HTML 渲染器把它转换为结构化的目录与文章列表。原始 markdown 源码仍保留正常的 `INDEX:START/END` 块。
