require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch Today's Diary
app.get('/api/today', async (req, res) => {
    const todayStr = new Date().toISOString().split('T')[0];
    let { data, error } = await supabase.from('daily_diaries').select('*').eq('date', todayStr).single();

    if (error && error.code === 'PGRST116') {
        const { data: newData, error: insertError } = await supabase.from('daily_diaries').insert([{ date: todayStr }]).select().single();
        if (insertError) return res.status(500).json({ error: insertError.message });
        data = newData;
    } else if (error) {
        return res.status(500).json({ error: error.message });
    }

    const { data: temps } = await supabase.from('temperature_logs').select('*').eq('diary_id', data.id);
    res.json({ diary: data, temps: temps || [] });
});

// Daily Log Endpoints
app.post('/api/update-checks', async (req, res) => {
    const { id, field, value } = req.body;
    const updateData = {}; updateData[field] = value;
    const { data, error } = await supabase.from('daily_diaries').update(updateData).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

app.post('/api/log-temp', async (req, res) => {
    const { diary_id, appliance_name, temperature, checked_by } = req.body;
    const { data, error } = await supabase.from('temperature_logs').insert([{ diary_id, appliance_name, temperature, checked_by }]).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

app.post('/api/sign-off', async (req, res) => {
    const { id, signature } = req.body;
    const { data, error } = await supabase.from('daily_diaries').update({ manager_signature: signature }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

// NEW: Save 4-Weekly Review Endpoint
app.post('/api/save-review', async (req, res) => {
    const reviewData = req.body;
    // Set date to today
    reviewData.date = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('four_weekly_reviews').upsert([reviewData], { onConflict: 'date' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// UPGRADED: Full EHO PDF Export
app.get('/api/export-pdf', async (req, res) => {
    const { data: diaries } = await supabase.from('daily_diaries').select('*').order('date', { ascending: false }).limit(30);
    const { data: temps } = await supabase.from('temperature_logs').select('*').order('checked_at', { ascending: false });
    const { data: reviews } = await supabase.from('four_weekly_reviews').select('*').order('date', { ascending: false }).limit(2);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=StreetFeast_SFBB_Log.pdf');
    doc.pipe(res);

    // Cover / Header
    doc.fontSize(22).font('Helvetica-Bold').text('Street Feast SFBB Compliance Log', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Official EHO Export', { align: 'center' });
    doc.moveDown(2);

    // Section 1: 4-Weekly Reviews
    if (reviews && reviews.length > 0) {
        doc.fontSize(16).font('Helvetica-Bold').text('Recent 4-Weekly Reviews', { underline: true });
        doc.moveDown(1);
        reviews.forEach(r => {
            doc.fontSize(12).font('Helvetica-Bold').text(`Review Date: ${r.date}`);
            doc.fontSize(10).font('Helvetica');
            doc.text(`Serious problem/failed 3 times?: ${r.serious_problem ? 'Yes' : 'No'}`);
            if (r.serious_problem) doc.text(`Details: ${r.problem_details}\nAction Taken: ${r.problem_action}`);
            
            doc.text(`New Staff: ${r.new_staff ? 'Yes' : 'No'} | Trained: ${r.staff_trained ? 'Yes' : 'No'}`);
            doc.text(`Menu Changed: ${r.menu_changed ? 'Yes' : 'No'} | Methods Reviewed: ${r.methods_reviewed ? 'Yes' : 'No'}`);
            if (r.method_changes) doc.text(`Method Changes: ${r.method_changes}`);
            
            doc.text(`New Suppliers: ${r.new_suppliers ? 'Yes' : 'No'}`);
            if (r.supplier_effects) doc.text(`Supplier Effects: ${r.supplier_effects}`);
            
            doc.text(`New Equipment: ${r.new_equipment ? 'Yes' : 'No'}`);
            if (r.equipment_effects) doc.text(`Equipment Effects: ${r.equipment_effects}`);
            
            if (r.other_changes) doc.text(`Other Changes: ${r.other_changes}`);
            doc.text(`Signed by: ${r.manager_signature || 'Unsigned'}`);
            doc.moveDown(1.5);
        });
        doc.addPage(); // Put daily logs on a fresh page
    }

    // Section 2: Daily Diaries
    doc.fontSize(16).font('Helvetica-Bold').text('Daily Logs & Temperatures (Last 30 Days)', { underline: true });
    doc.moveDown(1);

    diaries.forEach(diary => {
        doc.fontSize(12).font('Helvetica-Bold').text(`Date: ${diary.date}`);
        doc.fontSize(10).font('Helvetica').text(`Opening: ${diary.opening_checks_done ? 'Pass' : 'Fail'} | Closing: ${diary.closing_checks_done ? 'Pass' : 'Fail'} | Sign-off: ${diary.manager_signature || 'Not signed'}`);
        
        const dayTemps = temps.filter(t => t.diary_id === diary.id);
        if (dayTemps.length > 0) {
            dayTemps.forEach(t => {
                doc.text(`  • ${t.appliance_name}: ${t.temperature}°C (Logged by ${t.checked_by})`);
            });
        } else {
            doc.text(`  • No temperatures logged.`);
        }
        doc.moveDown(1);
    });

    doc.end();
});

// Fetch the Cleaning Schedule
app.get('/api/cleaning', async (req, res) => {
    const { data, error } = await supabase.from('cleaning_schedule').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

// Add a new item to the Cleaning Schedule
app.post('/api/cleaning', async (req, res) => {
    const { item_name, frequency, precautions, method } = req.body;
    const { data, error } = await supabase.from('cleaning_schedule').insert([{ item_name, frequency, precautions, method }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`SFBB Compliance app running on port ${PORT}`);
});
