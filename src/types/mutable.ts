export type MutableDeep<Type> = Type extends (...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : Type extends readonly (infer Item)[]
    ? MutableDeep<Item>[]
    : Type extends object
      ? { -readonly [Key in keyof Type]: MutableDeep<Type[Key]> }
      : Type;
