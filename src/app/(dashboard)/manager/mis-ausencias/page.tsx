import { MisAusenciasView } from "@/components/ausencias/mis-ausencias-view";

// Autoservicio del Coordinador (MANAGER): solicita y ve SUS propias ausencias,
// distinto de /manager/ausencias (gestión de las del equipo).
export default function ManagerMisAusenciasPage() {
  return <MisAusenciasView />;
}
