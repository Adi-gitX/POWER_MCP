import { Hero } from '@/components/site/hero';
import { Manifesto } from '@/components/site/manifesto';
import { Steps } from '@/components/site/steps';
import { Features } from '@/components/site/features';
import { Refusals } from '@/components/site/refusals';
import { ProofStrip } from '@/components/site/proof-strip';
import { PricingStrip } from '@/components/site/pricing-strip';
import { CTA } from '@/components/site/cta';

export default function HomePage() {
  return (
    <>
      <Hero />
      <Manifesto />
      <Steps />
      <Features />
      <Refusals />
      <ProofStrip />
      <PricingStrip />
      <CTA />
    </>
  );
}
