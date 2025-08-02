'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import ToolHeader from '@/components/ToolHeader';
import FileUpload from '@/components/FileUpload';
import ActionButton from '@/components/ActionButton';
import ProgressBar from '@/components/ProgressBar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faDownload, faTrash, faGripVertical, faObjectGroup, 
  faScissors
} from '@fortawesome/free-solid-svg-icons';

interface PDFFile {
  file: File;
  url: string;
  size: number;
  pages?: number;
}

interface SplitRange {
  start: number;
  end: number;
  id: string;
}

type OperationMode = 'merge' | 'split';

export default function PDFManagerPage() {
  const { t } = useLanguage();
  const [files, setFiles] = useState<PDFFile[]>([]);
  const [operationMode, setOperationMode] = useState<OperationMode>('merge');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ url: string; filename: string; size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pdfLib, setPdfLib] = useState<typeof import('pdf-lib') | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [isClient, setIsClient] = useState(false);

  // 分割模式状态
  const [splitMethod, setSplitMethod] = useState<'single_pages' | 'custom_ranges' | 'equal_parts'>('single_pages');
  const [startPage, _setStartPage] = useState(1);
  const [endPage, _setEndPage] = useState(1);
  const [customRanges, setCustomRanges] = useState<SplitRange[]>([]);
  const [customRangeInput, setCustomRangeInput] = useState('');
  const [partsCount, setPartsCount] = useState(2);

  // 合并模式状态
  const [outputName, setOutputName] = useState('merged_document.pdf');



  // 确保只在客户端运行
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 动态导入pdf-lib
  useEffect(() => {
    if (!isClient) return;

    const loadPdfLib = async () => {
      try {
        const pdfLibModule = await import('pdf-lib');
        setPdfLib(pdfLibModule);
      } catch (error) {
        console.error('Failed to load pdf-lib:', error);
        setError('PDF处理库加载失败');
      }
    };

    loadPdfLib();
  }, [isClient]);

  const handleFileSelect = useCallback((selectedFiles: File[]) => {
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    
    if (totalSize > 500 * 1024 * 1024) {
      setError(t('tools.pdf_manager.errors.file_too_large'));
      return;
    }

    const pdfFiles: PDFFile[] = selectedFiles.map(file => ({
      file,
      url: URL.createObjectURL(file),
      size: file.size
    }));

    setFiles(pdfFiles);
    setError(null);
  }, [t]);

  const handleFileError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const removeFile = useCallback((index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    setFiles(newFiles);
  }, [files]);

  const _moveFile = useCallback((fromIndex: number, toIndex: number) => {
    const newFiles = [...files];
    const [movedFile] = newFiles.splice(fromIndex, 1);
    newFiles.splice(toIndex, 0, movedFile);
    setFiles(newFiles);
  }, [files]);

  // 解析自定义范围输入
  const parseCustomRanges = useCallback((input: string): SplitRange[] => {
    const ranges: SplitRange[] = [];
    const parts = input.split(',').map(p => p.trim());
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n.trim()));
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          ranges.push({
            start,
            end,
            id: `${start}-${end}`
          });
        }
      } else {
        const page = parseInt(part);
        if (!isNaN(page)) {
          ranges.push({
            start: page,
            end: page,
            id: `${page}`
          });
        }
      }
    }
    
    return ranges;
  }, []);

  const addCustomRange = useCallback(() => {
    if (!customRangeInput.trim()) return;
    
    const newRanges = parseCustomRanges(customRangeInput);
    setCustomRanges(prev => [...prev, ...newRanges]);
    setCustomRangeInput('');
  }, [customRangeInput, parseCustomRanges]);

  const removeCustomRange = useCallback((id: string) => {
    setCustomRanges(prev => prev.filter(range => range.id !== id));
  }, []);

  // 重置所有状态到初始值
  const resetState = useCallback(() => {
    setFiles([]);
    setResults([]);
    setError(null);
    setProgress(0);
    setCustomRanges([]);
    setCustomRangeInput('');
    setOutputName('merged_document.pdf');
    setSplitMethod('single_pages');
    setPartsCount(2);
  }, []);

  // 切换操作模式时重置状态
  const handleOperationModeChange = useCallback((mode: OperationMode) => {
    setOperationMode(mode);
    resetState();
  }, [resetState]);

  const startOperation = useCallback(async () => {
    if (!pdfLib) {
      setError('PDF处理库未加载');
      return;
    }

    if (files.length === 0) {
      setError(t('tools.pdf_manager.errors.no_files'));
      return;
    }

    // 滚动到页面顶部，确保用户能看到进度
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    
    // 开始处理时滚动到进度条
    setTimeout(() => {
      const progressElement = document.querySelector('[data-progress]');
      if (progressElement) {
        progressElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    }, 50);

    try {
      if (operationMode === 'merge') {
        await performMerge();
      } else if (operationMode === 'split') {
        await performSplit();
      }
      
      // 操作完成后自动滚动到结果区域
      setTimeout(() => {
        if (resultsRef.current) {
          resultsRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 100);
    } catch (err) {
      console.error('PDF operation error:', err);
      setError(err instanceof Error ? err.message : t('tools.pdf_manager.errors.operation_failed'));
    } finally {
      setIsProcessing(false);
    }
  }, [files, operationMode, splitMethod, startPage, endPage, customRanges, partsCount, outputName, t, pdfLib]);

  const performMerge = useCallback(async () => {
    if (files.length < 2) {
      throw new Error(t('tools.pdf_manager.errors.need_at_least_two'));
    }

    // 创建新的PDF文档
    const mergedPdf = await pdfLib!.PDFDocument.create();
    setProgress(20);

    // 合并所有PDF文件
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arrayBuffer = await file.file.arrayBuffer();
        const pdf = await pdfLib!.PDFDocument.load(arrayBuffer);
        
        // 复制所有页面到合并文档
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
        
        setProgress(20 + (i + 1) * (60 / files.length));
              } catch {
          throw new Error(`处理文件失败: ${file.file.name}。请确保是有效的PDF文件。`);
        }
    }

    setProgress(80);

    // 生成合并后的PDF
    const mergedPdfBytes = await mergedPdf.save();
    setProgress(100);

    // 创建Blob并生成下载链接
    const mergedPdfBlob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    
    const result = {
      url: URL.createObjectURL(mergedPdfBlob),
      filename: outputName,
      size: mergedPdfBlob.size
    };

    setResults([result]);
  }, [files, outputName, t, pdfLib]);

  const performSplit = useCallback(async () => {
    if (files.length === 0) {
      throw new Error(t('tools.pdf_manager.errors.no_files'));
    }

    const file = files[0];
    const arrayBuffer = await file.file.arrayBuffer();
    const pdf = await pdfLib!.PDFDocument.load(arrayBuffer);
    const pageCount = pdf.getPageCount();

    setProgress(20);

    const splitResults: { url: string; filename: string; size: number }[] = [];

    if (splitMethod === 'single_pages') {
      // 单页分割
      for (let i = 0; i < pageCount; i++) {
        const newPdf = await pdfLib!.PDFDocument.create();
        const [page] = await newPdf.copyPages(pdf, [i]);
        newPdf.addPage(page);
        
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        
        splitResults.push({
          url: URL.createObjectURL(blob),
          filename: `${file.file.name.replace('.pdf', '')}_page_${i + 1}.pdf`,
          size: blob.size
        });
        
        setProgress(20 + (i + 1) * (60 / pageCount));
      }
    } else if (splitMethod === 'custom_ranges') {
      // 自定义范围分割
      const ranges = customRanges.length > 0 ? customRanges : [{ start: startPage, end: endPage, id: 'default' }];
      
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        if (range.start < 1 || range.end > pageCount || range.start > range.end) {
          throw new Error(t('tools.pdf_manager.errors.range_out_of_bounds'));
        }

        const newPdf = await pdfLib!.PDFDocument.create();
        const pageIndices = Array.from({ length: range.end - range.start + 1 }, (_, j) => range.start - 1 + j);
        const pages = await newPdf.copyPages(pdf, pageIndices);
        pages.forEach(page => newPdf.addPage(page));
        
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        
        splitResults.push({
          url: URL.createObjectURL(blob),
          filename: `${file.file.name.replace('.pdf', '')}_${range.start}-${range.end}.pdf`,
          size: blob.size
        });
        
        setProgress(20 + (i + 1) * (60 / ranges.length));
      }
    } else if (splitMethod === 'equal_parts') {
      // 等分分割
      if (partsCount < 2) {
        throw new Error(t('tools.pdf_manager.errors.invalid_parts_count'));
      }

      const pagesPerPart = Math.ceil(pageCount / partsCount);
      
      for (let i = 0; i < partsCount; i++) {
        const startPage = i * pagesPerPart + 1;
        const endPage = Math.min((i + 1) * pagesPerPart, pageCount);
        
        if (startPage > pageCount) break;

        const newPdf = await pdfLib!.PDFDocument.create();
        const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, j) => startPage - 1 + j);
        const pages = await newPdf.copyPages(pdf, pageIndices);
        pages.forEach(page => newPdf.addPage(page));
        
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        
        splitResults.push({
          url: URL.createObjectURL(blob),
          filename: `${file.file.name.replace('.pdf', '')}_part_${i + 1}.pdf`,
          size: blob.size
        });
        
        setProgress(20 + (i + 1) * (60 / partsCount));
      }
    }

    setProgress(100);
    setResults(splitResults);
  }, [files, splitMethod, startPage, endPage, customRanges, partsCount, t, pdfLib]);

  const downloadResult = useCallback((result: { url: string; filename: string; size: number }) => {
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const downloadAllResults = useCallback(() => {
    results.forEach(result => downloadResult(result));
  }, [results, downloadResult]);

  const clearAll = useCallback(() => {
    files.forEach(file => URL.revokeObjectURL(file.url));
    results.forEach(result => URL.revokeObjectURL(result.url));
    setFiles([]);
    setResults([]);
    setError(null);
    setProgress(0);
    setCustomRanges([]);
    setCustomRangeInput('');
  }, [files, results]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <ToolHeader 
        toolCode="pdf_manager"
        title={t('tools.pdf_manager.title')}
        description={t('tools.pdf_manager.description')}
        icon={faObjectGroup}
      />
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* 操作模式选择 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">{t('tools.pdf_manager.operation_mode.title')}</h3>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <button
                 onClick={() => handleOperationModeChange('merge')}
                 className={`p-4 rounded-lg border-2 transition-all ${
                   operationMode === 'merge'
                     ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                     : 'border-gray-600 bg-gray-700 hover:border-gray-500'
                 }`}
               >
                 <FontAwesomeIcon icon={faObjectGroup} className="text-2xl mb-2" />
                 <div className="font-medium">{t('tools.pdf_manager.operation_mode.merge')}</div>
               </button>
               <button
                 onClick={() => handleOperationModeChange('split')}
                 className={`p-4 rounded-lg border-2 transition-all ${
                   operationMode === 'split'
                     ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                     : 'border-gray-600 bg-gray-700 hover:border-gray-500'
                 }`}
               >
                 <FontAwesomeIcon icon={faScissors} className="text-2xl mb-2" />
                 <div className="font-medium">{t('tools.pdf_manager.operation_mode.split')}</div>
               </button>
             </div>
          </div>

          {/* 文件上传 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <FileUpload
              accept=".pdf"
              maxSize={operationMode === 'merge' ? 500 * 1024 * 1024 : 100 * 1024 * 1024}
              multiple={operationMode === 'merge'}
              onFileSelect={handleFileSelect}
              onError={handleFileError}
              title={t('tools.pdf_manager.upload_area.title')}
              subtitle={t('tools.pdf_manager.upload_area.subtitle')}
              buttonText={t('tools.pdf_manager.upload_area.button')}
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-600 text-white p-4 rounded-lg">
              {error}
            </div>
          )}

          {/* 文件列表 */}
          {files.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{t('tools.pdf_manager.file_list.title')}</h3>
                <div className="text-sm text-gray-400">
                  {t('tools.pdf_manager.file_list.total_size')}: {formatFileSize(totalSize)}
                </div>
              </div>
              
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between bg-gray-700 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3">
                      <FontAwesomeIcon icon={faGripVertical} className="text-gray-400 cursor-move" />
                      <div>
                        <p className="text-sm font-medium">{file.file.name}</p>
                        <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => removeFile(index)}
                        className="text-gray-400 hover:text-red-400 transition-colors"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              <p className="text-xs text-gray-400 mt-2">
                {t('tools.pdf_manager.file_list.drag_hint')}
              </p>
            </div>
          )}

          {/* 操作设置 */}
          {files.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-6">
              {operationMode === 'merge' && (
                <div>
                  <h3 className="text-lg font-semibold mb-4">{t('tools.pdf_manager.merge_mode.title')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        {t('tools.pdf_manager.merge_mode.output_name')}
                      </label>
                      <input
                        type="text"
                        value={outputName}
                        onChange={(e) => setOutputName(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
                        placeholder="merged_document.pdf"
                      />
                    </div>
                  </div>
                </div>
              )}

              {operationMode === 'split' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">{t('tools.pdf_manager.split_mode.title')}</h3>
                  
                  {/* 分割方式选择 */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t('tools.pdf_manager.split_mode.split_method')}
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {(['single_pages', 'custom_ranges', 'equal_parts'] as const).map((method) => (
                        <button
                          key={method}
                          onClick={() => setSplitMethod(method)}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            splitMethod === method
                              ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                              : 'border-gray-600 bg-gray-700 hover:border-gray-500'
                          }`}
                        >
                          {t(`tools.pdf_manager.split_methods.${method}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 单页分割设置 */}
                  {splitMethod === 'single_pages' && (
                    <div className="bg-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-300">
                        {t('tools.pdf_manager.split_methods.single_pages')} - {t('tools.pdf_manager.split_methods.single_pages_description')}
                      </p>
                    </div>
                  )}

                  {/* 自定义范围设置 */}
                  {splitMethod === 'custom_ranges' && (
                    <div className="space-y-4">
                      <div className="bg-gray-700 rounded-lg p-4">
                        <label className="block text-sm font-medium mb-2">
                          {t('tools.pdf_manager.custom_ranges.title')}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customRangeInput}
                            onChange={(e) => setCustomRangeInput(e.target.value)}
                            className="flex-1 bg-gray-600 border border-gray-500 rounded-lg px-3 py-2"
                            placeholder={t('tools.pdf_manager.custom_ranges.placeholder')}
                          />
                          <button
                            onClick={addCustomRange}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                          >
                            {t('tools.pdf_manager.custom_ranges.add_range')}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          {t('tools.pdf_manager.custom_ranges.range_format')}
                        </p>
                      </div>

                      {customRanges.length > 0 && (
                        <div className="space-y-2">
                          {customRanges.map((range) => (
                            <div key={range.id} className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                                                             <span className="text-sm">
                                 {range.start === range.end 
                                   ? t('tools.pdf_manager.custom_ranges.single_page').replace('{page}', range.start.toString())
                                   : t('tools.pdf_manager.custom_ranges.page_range').replace('{start}', range.start.toString()).replace('{end}', range.end.toString())
                                 }
                               </span>
                              <button
                                onClick={() => removeCustomRange(range.id)}
                                className="text-red-400 hover:text-red-300 transition-colors"
                              >
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 等分分割设置 */}
                  {splitMethod === 'equal_parts' && (
                    <div className="bg-gray-700 rounded-lg p-4">
                      <label className="block text-sm font-medium mb-2">
                        {t('tools.pdf_manager.equal_parts.parts_count')}
                      </label>
                      <input
                        type="number"
                        min="2"
                        value={partsCount}
                        onChange={(e) => setPartsCount(parseInt(e.target.value) || 2)}
                        className="w-full bg-gray-600 border border-gray-500 rounded-lg px-3 py-2"
                      />
                    </div>
                  )}
                </div>
              )}

              
            </div>
          )}

          {/* 处理进度 */}
          {isProcessing && (
            <div data-progress>
              <ProgressBar
                progress={progress}
                             status={t(`tools.pdf_manager.status.${operationMode === 'merge' ? 'merging' : 'splitting'}`)}
                onCancel={() => setIsProcessing(false)}
              />
            </div>
          )}

          {/* 操作按钮 */}
          {files.length > 0 && !isProcessing && (
            <div className="flex gap-4">
              <ActionButton
                onClick={startOperation}
                loading={isProcessing}
                disabled={files.length === 0}
              >
                                 {t(`tools.pdf_manager.actions.${operationMode === 'merge' ? 'merge' : 'split'}`)}
              </ActionButton>
              <ActionButton
                onClick={clearAll}
                variant="secondary"
              >
                {t('tools.pdf_manager.actions.clear')}
              </ActionButton>
            </div>
          )}

          {/* 操作结果 */}
          {results.length > 0 && (
            <div ref={resultsRef} className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{t('tools.pdf_manager.results.title')}</h3>
                <div className="text-sm text-gray-400">
                  {t('tools.pdf_manager.results.files_count')}: {results.length}
                </div>
              </div>
              
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium">{result.filename}</p>
                      <p className="text-xs text-gray-400">{formatFileSize(result.size)}</p>
                    </div>
                    <ActionButton
                      onClick={() => downloadResult(result)}
                      variant="primary"
                      size="sm"
                      icon={faDownload}
                    >
                      {t('tools.pdf_manager.actions.download')}
                    </ActionButton>
                  </div>
                ))}
              </div>
              
              {results.length > 1 && (
                <div className="mt-4 pt-4 border-t border-gray-600">
                  <ActionButton
                    onClick={downloadAllResults}
                    variant="primary"
                    icon={faDownload}
                  >
                    {t('tools.pdf_manager.results.download_all')}
                  </ActionButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 