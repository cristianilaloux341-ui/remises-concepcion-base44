import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DraggableModal({ title, isOpen, onClose, children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const modalRef = useRef(null);

  useEffect(() => {
    if (isOpen && pos.x === 0 && pos.y === 0) {
      // Center initially
      setPos({
        x: Math.max(0, window.innerWidth / 2 - 200),
        y: Math.max(0, window.innerHeight / 2 - 250),
      });
    }
  }, [isOpen, pos.x, pos.y]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPos((prev) => ({
        x: prev.x + e.movementX,
        y: prev.y + e.movementY,
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed z-[9999] w-[400px] max-w-[90vw] bg-card border shadow-2xl rounded-xl flex flex-col"
      style={{ left: pos.x, top: pos.y, maxHeight: "80vh" }}
    >
      <div
        className="px-4 py-3 border-b bg-muted/50 flex justify-between items-center rounded-t-xl cursor-move touch-none"
        onMouseDown={(e) => {
          setIsDragging(true);
          dragStart.current = { x: e.clientX, y: e.clientY };
        }}
      >
        <span className="font-semibold text-sm select-none">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 hover:bg-destructive/10 hover:text-destructive shrink-0"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()} // Prevent drag start when clicking close
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="p-4 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}