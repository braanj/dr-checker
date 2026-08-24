import type { Config } from "tailwindcss";

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#0071e3",
          hover: "#0077ed",
          light: "#e8f2fd",
        },
      },
      backgroundImage: {
        "hero-radial": "radial-gradient(120% 120% at 50% 0%, #ffffff 0%, #f5f5f7 60%, #f5f5f7 100%)",
      },
    },
  },
};
