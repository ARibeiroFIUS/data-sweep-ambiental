export function cleanCPF(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatCPF(value: string): string {
  const digits = cleanCPF(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function isValidCPF(value: string): boolean {
  const cpf = cleanCPF(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base: string, factor: number) => {
    let total = 0;
    for (let i = 0; i < base.length; i += 1) {
      total += Number(base[i]) * (factor - i);
    }
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const first = calcDigit(cpf.slice(0, 9), 10);
  const second = calcDigit(cpf.slice(0, 10), 11);
  return cpf.endsWith(`${first}${second}`);
}
