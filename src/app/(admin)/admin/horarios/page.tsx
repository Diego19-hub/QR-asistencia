import { ScheduleManagement } from "@/components/schedules/schedule-management";

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ employeeId?: string }> }) {
  const params = await searchParams;
  return <ScheduleManagement employeeId={params.employeeId} />;
}
