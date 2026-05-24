# LYAPI 與 Lawtrace 對接筆記

這份文件只保留 v2 仍有用的資料來源與 mapping 策略。舊版 `find-by-agenda-id` 轉址已不使用。

## 核心實體

```text
Gazette
  公報編號
  卷 / 期 / 冊別
  發布日期

GazetteAgenda
  公報議程編號
  公報編號
  類別代碼
  會議日期
  案由
  公報網網址
  公報完整PDF網址
  處理後公報網址

Meet
  會議代碼
  會議日期
  委員會 / 會議名稱
  議事網資料
  關係文書 / 議案

Bill
  議案編號
  法律編號
  議案流程
```

## 已驗證資料來源

lyzer 現在主要用：

```text
GET /gazettes?page=1&limit=N
GET /gazettes/{gazette_id}/agendas?page=1&limit=N
```

實際回傳 pagination 欄位包含：

```text
total
total_page
page
limit
```

注意：本機 swagger schema 曾出現 `total_pages`，但真實 endpoint 回傳是 `total_page`。

## 公報議程文件 URL

`GazetteAgenda` 的 `處理後公報網址` 可能包含：

- `html`
- `tikahtml`
- `txt`
- `parsed`

目前策略：

1. 優先抓所有 `parsed` URL。
2. 若 parsed 全部失敗，fallback 到 `txt` URL。
3. `agendas.raw` 保留完整原始 JSON，方便未來重新解析。

## 類別代碼

目前 AI 分析只處理：

```text
category_code = 3
```

其他類別先不分析。

## Lawtrace 對接方向

舊方向：

```text
Lawtrace -> find-by-agenda-id -> analyzed_content_id -> detailedGazette/{uuid}
```

v2 不使用這個方向，因為 detail route 已改成：

```text
/gazettes/{agenda_id}
```

新方向：

```text
Lawtrace -> /gazettes/{agenda_id}
lyzer -> Lawtrace bill/law compare URL
```

## Agenda 到 Bill 的 mapping 候選流程

優先流程：

1. 從 `agendas.meeting_dates`、委員會資訊、`agenda_id` 或 raw metadata 找 meet candidate。
2. 查 `/meets` 或 `/meets/{id}`。
3. 從 `議事網資料.關係文書.議案` 拆出 bill numbers。
4. 寫入 `agenda_bills`。
5. 詳細頁依 `agenda_bills` 顯示 Lawtrace links。

輔助流程：

- 用 `/bills/{billNo}/meets` 回查 meet 是否能對上 agenda。
- `/meets/{id}/bills` 可以參考，但不要先假設它比 raw `議事網資料` 更完整。

## Lawtrace URL

目前候選格式：

```text
https://lawtrace.tw/law/compare?source=bill:{billNo}
```

實作前需用 `lawtrace-main` 確認現行 URL 格式。

## 未解問題

- Meet API 是否穩定包含 agenda 可對應資訊。
- 一個 agenda 對多個 meet 的情境如何處理。
- 一個 meet 包含多個 agenda / 多個 bill 時如何避免錯配。
- Lawtrace 最終要連 bill compare、law compare，還是搜尋頁。
