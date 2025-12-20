"use client";

import { CheckCircle, XCircle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FeedbackPopupProps {
  isOpen: boolean;
  onClose: () => void;
  success: boolean;
  title: string;
  message: string;
  questionsGenerated?: number;
}

export function FeedbackPopup({
  isOpen,
  onClose,
  success,
  title,
  message,
  questionsGenerated,
}: FeedbackPopupProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {success ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {success && questionsGenerated && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm font-medium text-green-800">
                Successfully generated {questionsGenerated} questions!
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose} className="w-full sm:w-auto">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}