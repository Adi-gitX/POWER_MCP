import { ScrollFillText } from '@/components/motion/scroll-fill';

export function Manifesto() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="mb-10 text-center">
          <span className="eyebrow">Why Power exists</span>
        </div>
        <ScrollFillText
          text="You already have a brilliant model. What you don’t have is anything checking its work. It writes the plan and grades the plan. It edits your live database because nothing stops it. When it says done, you find out later."
          last="So we built the thing that says no."
        />
      </div>
    </section>
  );
}
