# backend/fixtures

以下数据均抓取于 2026-10-31，供 `COLLECTOR_MODE=fixture`、未配置模型时的固定输出和自动化测试使用。

| 文件 | 来源 | 说明 |
|---|---|---|
| `federal_register/documents_ustr_cbp_2026-10-01_2026-10-29.json` | 联邦公报 documents API（USTR + CBP，2026-10-01 起） | 原样保存；只含标题等基础字段 |
| `federal_register/public_inspection_current_2026-10-31.json` | public-inspection current.json | 原样保存；共 108 篇，按机构过滤后剩 10 篇 |
| `federal_register/public_inspection_unavailable_example.json` | public-inspection 搜索接口的「不可用」响应 | 原样保存 |
| `federal_register/document_2026-20510_fields.json` | 2026-20510 的 abstract、action、dates 等字段 | 原样保存 |
| `federal_register/document_2026-20511_raw_text.html` | 2026-20511 的 raw_text_url | 联系邮箱已删除，行尾空格已去掉，正文未改动 |
| `usitc/releaseList_2026-10-31.json` | USITC releaseList | 原样保存；当前版本为 2026HTSRev22 |
| `usitc/search_<code>.json` | USITC search | 原样保存；含 9903.05.31、8501.10.40、8479.50.00 三个税号 |
| `llm/triage.json` | 人工标注 | 23 篇的分诊固定输出 |
| `llm/extract.json` | 人工标注 | 2026-20511、2026-20510 两篇的抽取固定输出 |
