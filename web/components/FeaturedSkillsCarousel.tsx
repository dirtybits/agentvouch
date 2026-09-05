"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

interface FeaturedSkillsCarouselProps {
  children: ReactNode;
}

export function FeaturedSkillsCarousel({
  children,
}: FeaturedSkillsCarouselProps) {
  const items = Children.toArray(children);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [snapCount, setSnapCount] = useState(0);

  useEffect(() => {
    if (!api) return;

    const updateCarousel = () => {
      setCurrent(api.selectedScrollSnap());
      setSnapCount(api.scrollSnapList().length);
    };
    updateCarousel();
    api.on("reInit", updateCarousel);
    api.on("select", updateCarousel);

    return () => {
      api.off("reInit", updateCarousel);
      api.off("select", updateCarousel);
    };
  }, [api]);

  if (items.length === 0) return null;

  return (
    <div className="relative px-3 sm:px-4">
      <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: items.length > 1 }}
        aria-label="Featured skills"
      >
        <CarouselContent>
          {items.map((item, index) => (
            <CarouselItem
              key={`featured-skill-${index}`}
              className="sm:basis-1/2 lg:basis-1/3"
            >
              <div className="h-full">{item}</div>
            </CarouselItem>
          ))}
        </CarouselContent>
        {snapCount > 1 && (
          <>
            <CarouselPrevious className="max-[30rem]:hidden lg:-left-3" />
            <CarouselNext className="max-[30rem]:hidden lg:-right-3" />
          </>
        )}
      </Carousel>

      {snapCount > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div
            className="flex items-center gap-1.5"
            role="group"
            aria-label="Choose featured skill"
          >
            {Array.from({ length: snapCount }, (_, index) => {
              const isCurrent = current === index;

              return (
                <button
                  key={`featured-skill-dot-${index}`}
                  type="button"
                  aria-label={`Show featured skill ${index + 1}`}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => api?.scrollTo(index)}
                  className={`h-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lobster-accent-border)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 ${
                    isCurrent
                      ? "w-6 bg-[var(--lobster-accent)]"
                      : "w-1.5 bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600"
                  }`}
                />
              );
            })}
          </div>
          <span
            className="font-mono text-[10px] font-bold tracking-[0.16em] text-gray-400 dark:text-gray-500"
            aria-live="polite"
          >
            {String(current + 1).padStart(2, "0")} /{" "}
            {String(snapCount).padStart(2, "0")}
          </span>
        </div>
      )}
    </div>
  );
}
