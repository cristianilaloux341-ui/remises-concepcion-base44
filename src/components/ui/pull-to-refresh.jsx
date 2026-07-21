import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function PullToRefresh({ onRefresh, children }) {
  const [startY, setStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  
  const pullDistance = Math.max(0, currentY - startY);
  const threshold = 60;

  const handleTouchStart = (e) => {
    const scroller = e.target.closest('.overflow-y-auto') || e.target.closest('.overflow-auto');
    if (!scroller || scroller.scrollTop <= 1) {
      setStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (startY > 0) {
      const scroller = e.target.closest('.overflow-y-auto') || e.target.closest('.overflow-auto');
      if (!scroller || scroller.scrollTop <= 1) {
        setCurrentY(e.touches[0].clientY);
      } else {
        setStartY(0);
        setCurrentY(0);
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance > threshold && !refreshing) {
      setRefreshing(true);
      if (onRefresh) {
        try { await onRefresh(); } catch (error) { console.error(error); }
      }
      setRefreshing(false);
    }
    setStartY(0);
    setCurrentY(0);
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="flex-1 flex flex-col min-h-0 w-full relative"
    >
      <div 
        className="shrink-0 flex items-center justify-center overflow-hidden transition-all duration-300 ease-out text-muted-foreground w-full absolute top-0 left-0 z-10"
        style={{ 
          height: refreshing ? '60px' : `${Math.min(pullDistance, 60)}px`,
          opacity: Math.min(pullDistance / threshold, 1)
        }}
      >
        {refreshing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <div className="text-xs font-medium">Suelta para actualizar</div>
        )}
      </div>
      <div className="flex-1 flex flex-col min-h-0 transition-transform duration-300" style={{ transform: `translateY(${refreshing ? 60 : Math.min(pullDistance * 0.5, 30)}px)` }}>
        {children}
      </div>
    </div>
  );
}