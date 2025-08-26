-- 1. 在 gazette_agendas 表中新增一個可以為空的 UUID 欄位
ALTER TABLE public.gazette_agendas
ADD COLUMN analyzed_content_id UUID;

-- 2. 為了加速查詢，為這個新欄位建立索引
CREATE INDEX idx_gazette_agendas_analyzed_content_id ON public.gazette_agendas (analyzed_content_id);

-- 3. 建立外鍵約束，確保資料的完整性
-- 這會讓 analyzed_content_id 欄位的值必須存在於 analyzed_contents 表的 id 欄位中
ALTER TABLE public.gazette_agendas
ADD CONSTRAINT fk_analyzed_content FOREIGN KEY (analyzed_content_id) REFERENCES public.analyzed_contents (id) ON DELETE SET NULL;

-- 如果分析結果被刪除，則將此欄位設為 NULL