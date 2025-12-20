"use client";

import React, { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileDropzoneProps {
  onFilesChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  maxSize?: number; // in bytes
  className?: string;
  children?: React.ReactNode;
}

export function FileDropzone({
  onFilesChange,
  accept = ".txt,.md,.pdf,.docx",
  multiple = true,
  disabled = false,
  maxSize = 10 * 1024 * 1024, // 10MB default
  className,
  children,
}: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback(
    (files: FileList | File[]): File[] => {
      const validFiles: File[] = [];
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        // Check file size
        if (maxSize && file.size > maxSize) {
          console.warn(`File ${file.name} is too large (${file.size} bytes)`);
          continue;
        }

        // Check file type if accept prop is provided
        if (accept) {
          const acceptedTypes = accept.split(",").map((type) => type.trim());
          const fileExtension = `.${file.name.split(".").pop()?.toLowerCase()}`;
          const isAccepted = acceptedTypes.some((type) => {
            if (type.startsWith(".")) {
              return type === fileExtension;
            }
            return file.type.match(new RegExp(type.replace("*", ".*")));
          });

          if (!isAccepted) {
            console.warn(`File ${file.name} type not accepted`);
            continue;
          }
        }

        validFiles.push(file);
      }

      return validFiles;
    },
    [accept, maxSize]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (disabled) return;

      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesChange(validFiles);
      }
    },
    [disabled, validateFiles, onFilesChange]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setDragCounter((prev) => prev + 1);

      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setDragCounter((prev) => {
        const newCounter = prev - 1;
        if (newCounter === 0) {
          setIsDragOver(false);
        }
        return newCounter;
      });
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      // Ensure we maintain the drag over state
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setIsDragOver(false);
      setDragCounter(0);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [disabled, handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
        // Reset input to allow re-uploading same file
        e.target.value = "";
      }
    },
    [handleFiles]
  );

  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  return (
    <div
      className={cn(
        "relative border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 transition-colors",
        "hover:border-muted-foreground/50 cursor-pointer",
        isDragOver && "border-primary bg-primary/5",
        disabled &&
          "opacity-50 cursor-not-allowed hover:border-muted-foreground/25",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleInputChange}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="File upload"
      />

      {children || (
        <div className="flex flex-col items-center justify-center text-center">
          <FileUp
            className={cn(
              "h-8 w-8 mb-2 text-muted-foreground",
              isDragOver && "text-primary"
            )}
          />
          <p className="text-sm font-medium mb-1">
            {isDragOver
              ? "Drop files here"
              : "Click to upload or drag and drop"}
          </p>
          <p className="text-xs text-muted-foreground">
            {accept
              ? `Supported formats: ${accept}`
              : "All file types supported"}
            {maxSize && ` (max ${Math.round(maxSize / 1024 / 1024)}MB)`}
          </p>
        </div>
      )}
    </div>
  );
}

interface FileDropzoneWithListProps extends FileDropzoneProps {
  files: File[];
  onRemoveFile: (index: number) => void;
  isProcessing?: boolean;
}

export function FileDropzoneWithList({
  files,
  onRemoveFile,
  isProcessing = false,
  ...dropzoneProps
}: FileDropzoneWithListProps) {
  return (
    <div className="space-y-4">
      <FileDropzone
        {...dropzoneProps}
        disabled={dropzoneProps.disabled || isProcessing}
      />

      {isProcessing && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-foreground"></div>
          Processing files...
        </p>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Uploaded files ({files.length}):
          </p>
          <div className="space-y-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md"
              >
                <span className="truncate flex-1" title={file.name}>
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground/70 mr-2">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile(index);
                  }}
                  className="h-6 w-6 p-0 flex-shrink-0"
                  disabled={isProcessing}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
