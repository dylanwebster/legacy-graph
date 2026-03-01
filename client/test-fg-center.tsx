import React, { useRef } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';

export function Test() {
  const ref = useRef<ForceGraphMethods>(null);
  
  const onClick = () => {
    const center = ref.current?.centerAt();
    console.log(center);
  }
}
