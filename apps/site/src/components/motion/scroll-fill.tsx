'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'motion/react';

/**
 * The manifesto: words take ink as the block crosses the viewport, the last
 * line arrives in blue. Static for reduced motion and on small screens.
 */
export function ScrollFillText({ text, last }: { text: string; last: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.85', 'end 0.55'],
  });

  const words = text.split(' ');
  const endOpacity = useTransform(scrollYProgress, [0.85, 1], [0, 1]);
  const endY = useTransform(scrollYProgress, [0.85, 1], [10, 0]);

  if (reduced) {
    return (
      <div className="text-center">
        <p className="serif mx-auto max-w-[26ch] text-serif-lg font-medium tracking-tight">{text}</p>
        <p className="serif mt-[0.38em] text-serif-lg font-medium italic tracking-tight text-blue">{last}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="text-center">
      <p className="serif mx-auto flex max-w-[26ch] flex-wrap justify-center gap-x-[0.28em] text-serif-lg font-medium tracking-tight">
        {words.map((w, i) => (
          <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1.6) / words.length]}>
            {w}
          </Word>
        ))}
      </p>
      <motion.p
        style={{ opacity: endOpacity, y: endY }}
        className="serif mt-[0.38em] text-serif-lg font-medium italic tracking-tight text-blue"
      >
        {last}
      </motion.p>
    </div>
  );
}

function Word({
  children, progress, range,
}: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const color = useTransform(progress, range, ['#c9d0dd', '#191a1d']);
  return <motion.span style={{ color }}>{children}</motion.span>;
}
