import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { buildTimeForecast } from './timeGrid';

export const exportExecSummaryPDF = (resources: Resource[], projects: Project[], allocations: Allocation[]) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let currentY = 20;

    // --- Header ---
    doc.setFillColor(30, 41, 59); // Slate 800
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text("PMO Executive Summary", 14, 25);

    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${dateStr}`, pageWidth - 14, 25, { align: "right" });

    currentY = 55;

    // --- High-Level Metrics ---
    const totalFTE = allocations.reduce((sum, a) => sum + a.percentage, 0) / 100;
    const estMonthlyCost = allocations.reduce((sum, a) => {
        const res = resources.find(r => r.id === a.resourceId);
        const rate = res?.dailyRate || 0;
        return sum + (rate * 20 * (a.percentage / 100)); // 20 working days
    }, 0);

    doc.setTextColor(15, 23, 42); // Slate 900
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Portfolio Overview", 14, currentY);
    currentY += 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Active Projects: ${projects.filter(p => p.status === 'Active').length} / ${projects.length} Total`, 14, currentY);
    doc.text(`Total FTE Committed: ${totalFTE.toFixed(1)}`, 14, currentY + 6);
    doc.text(`Est. Monthly Run Rate: €${estMonthlyCost.toLocaleString()}`, 14, currentY + 12);

    currentY += 25;

    // --- Risk Scanner: Over-Allocated Resources ---
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Risk Scanner: Over-Allocated Personnel (>100%)", 14, currentY);
    currentY += 6;

    const overAllocated = resources.map(res => {
        const util = allocations.filter(a => a.resourceId === res.id).reduce((s, a) => s + a.percentage, 0);
        return { ...res, util };
    }).filter(r => r.util > 100).sort((a, b) => b.util - a.util);

    if (overAllocated.length > 0) {
        autoTable(doc, {
            startY: currentY,
            head: [['Resource', 'Department', 'Role', 'Total Utilization']],
            body: overAllocated.map(r => [r.name, r.department || '-', r.role || '-', `${r.util}%`]),
            headStyles: { fillColor: [239, 68, 68] }, // Red header for risk
            theme: 'grid',
            styles: { fontSize: 9 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 15;
    } else {
        doc.setFontSize(11);
        doc.setFont("helvetica", "italic");
        doc.text("No resources are currently over-allocated. Capacity is healthy.", 14, currentY);
        currentY += 15;
    }

    // --- Project Delivery Bottlenecks (FTE Breakdown) ---
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Project Capacity Distribution", 14, currentY);
    currentY += 6;

    const projectData = projects.map(p => {
        const projAllocs = allocations.filter(a => a.projectId === p.id);
        const fte = projAllocs.reduce((s, a) => s + a.percentage, 0) / 100;
        const cost = projAllocs.reduce((sum, a) => {
            const res = resources.find(r => r.id === a.resourceId);
            return sum + ((res?.dailyRate || 0) * 20 * (a.percentage / 100));
        }, 0);
        return [p.name, p.status, p.priority, `${fte.toFixed(1)} FTE`, `€${cost.toLocaleString()}`];
    });

    autoTable(doc, {
        startY: currentY,
        head: [['Project Name', 'Status', 'Priority', 'Committed FTE', 'Monthly Cost']],
        body: projectData,
        headStyles: { fillColor: [59, 130, 246] }, // Blue header
        theme: 'striped',
        styles: { fontSize: 9 },
    });

    // --- 6-Month Availability Forecast ---
    const lastY = (doc as any).lastAutoTable.finalY + 20;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("6-Month Resource Availability Forecast", 14, lastY);

    const dummyForecast = buildTimeForecast([], [], 6);
    const monthLabels = dummyForecast.map(f => f.label);

    const forecastData = resources.map(res => {
        const resAllocs = allocations.filter(a => a.resourceId === res.id);
        const forecast = buildTimeForecast(resAllocs, projects, 6);
        // Add an asterisk if they have 0 allocation for a month (Available)
        return [res.name, ...forecast.map(f => f.percentage === 0 ? '0% (Avail)' : `${f.percentage}%`)];
    });

    autoTable(doc, {
        startY: lastY + 6,
        head: [['Resource', ...monthLabels]],
        body: forecastData,
        headStyles: { fillColor: [16, 185, 129] }, // Emerald header
        theme: 'grid',
        styles: { fontSize: 8 },
    });

    // --- Footer ---
    const totalPages = (doc.internal as any).getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184); // Slate 400
        doc.text(`PMO Capacity Planner - Page ${i} of ${totalPages}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }

    // Save PDF
    doc.save(`PMO_Exec_Summary_${dateStr.replace(/ /g, '_')}.pdf`);
};
