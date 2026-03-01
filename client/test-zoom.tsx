import React, { useEffect, useRef } from 'react';
export function UseEffectTiming() {
  const ref = useRef(false);
  useEffect(() => {
      console.log('Mount', ref.current);
      return () => console.log('Unmount');
  }, []);
}
