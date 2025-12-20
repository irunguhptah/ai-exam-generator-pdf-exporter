-- Add PDF metadata fields to exams table
ALTER TABLE exams ADD COLUMN subtitle TEXT;
ALTER TABLE exams ADD COLUMN exam_overview TEXT;
ALTER TABLE exams ADD COLUMN exam_features TEXT; -- JSON string of features array
ALTER TABLE exams ADD COLUMN core_testing_areas_formatted TEXT; -- Formatted core testing areas for PDF
ALTER TABLE exams ADD COLUMN domains_metadata TEXT; -- JSON string of domain distribution