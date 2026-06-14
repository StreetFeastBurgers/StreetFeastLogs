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

app.post('/api/save-review', async (req, res) => {
    const reviewData = req.body;
    reviewData.date = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('four_weekly_reviews').upsert([reviewData], { onConflict: 'date' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Cleaning Schedule Endpoints
app.get('/api/cleaning', async (req, res) => {
    const { data, error } = await supabase.from('cleaning_schedule').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.post('/api/cleaning', async (req, res) => {
    const { item_name, frequency, precautions, method } = req.body;
    const { data, error } = await supabase.from('cleaning_schedule').insert([{ item_name, frequency, precautions, method }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Full EHO PDF Export with Legal Disclaimer
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
    doc.moveDown(1);
    
    // NEW: Legal Disclaimer
    doc.fontSize(10).font('Helvetica-Oblique').text('LEGAL COMPLIANCE STATEMENT: To comply with Food Standards Agency (FSA) regulations, this digital diary utilises an append-only database structure. All temperatures, daily checks, and reviews are permanently timestamped at the point of entry and cannot be amended, backdated, or deleted by management or staff.', { align: 'center', width: 450, continued: false });
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
        doc.fontSize(10).font('Helvetica').text(`Opening Checks: ${diary.opening_checks_done ? 'Pass' : 'Fail'} | Closing Checks: ${diary.closing_checks_done ? 'Pass' : 'Fail'}`);
        
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

// --- ALLERGEN MATRIX ENDPOINTS ---
app.get('/api/allergens', async (req, res) => {
    const { data, error } = await supabase.from('allergens_matrix').select('*').order('dish_name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message }); res.json(data || []);
});

app.post('/api/allergens', async (req, res) => {
    const { data, error } = await supabase.from('allergens_matrix').insert([req.body]).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

app.delete('/api/allergens/:id', async (req, res) => {
    const { error } = await supabase.from('allergens_matrix').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message }); res.json({ success: true });
});

app.get('/api/allergen-signoff', async (req, res) => {
    const { data, error } = await supabase.from('allergen_signoff').select('*').order('created_at', { ascending: false }).limit(1).single();
    res.json(data || null);
});

app.post('/api/allergen-signoff', async (req, res) => {
    const { reviewed_by, review_date } = req.body;
    const { data, error } = await supabase.from('allergen_signoff').insert([{ reviewed_by, review_date }]).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

// Full Allergen PDF Export (Landscape)
app.get('/api/export-allergen-pdf', async (req, res) => {
    const { data: dishes } = await supabase.from('allergens_matrix').select('*').order('dish_name', { ascending: true });
    const { data: signoff } = await supabase.from('allergen_signoff').select('*').order('created_at', { ascending: false }).limit(1).single();

    // Landscape orientation to fit 15 columns
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=StreetFeast_Allergen_Matrix.pdf');
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('DISHES AND THEIR ALLERGEN CONTENT - Street Feast', { align: 'left' });
    doc.moveDown(1.5);

    const startX = 30;
    let currentY = doc.y;
    const dishWidth = 140;
    const colWidth = 45;
    const keys = ['celery', 'cereals', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soya', 'sulphur'];
    const labels = ['Celery', 'Gluten', 'Crust.', 'Eggs', 'Fish', 'Lupin', 'Milk', 'Molluscs', 'Mustard', 'Nuts', 'Peanuts', 'Sesame', 'Soya', 'Sulphur'];

    // Draw Headers
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('DISHES', startX, currentY, { width: dishWidth });
    labels.forEach((lbl, i) => {
        doc.text(lbl, startX + dishWidth + (i * colWidth), currentY, { width: colWidth, align: 'center' });
    });
    
    currentY += 15;
    doc.moveTo(startX, currentY).lineTo(810, currentY).stroke('#00a896');
    currentY += 10;

    // Draw Rows
    doc.font('Helvetica');
    if(dishes) {
        dishes.forEach(dish => {
            doc.text(dish.dish_name, startX, currentY, { width: dishWidth });
            keys.forEach((key, i) => {
                const mark = dish[key] ? 'X' : '';
                doc.text(mark, startX + dishWidth + (i * colWidth), currentY, { width: colWidth, align: 'center' });
            });
            currentY += 15;
            doc.moveTo(startX, currentY).lineTo(810, currentY).stroke('#dddddd');
            currentY += 10;

            if (currentY > 500) { doc.addPage(); currentY = 40; } // New page if full
        });
    }

    doc.moveDown(2);
    currentY += 30;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`Review Date: ${signoff ? signoff.review_date : 'Not signed'}`, startX, currentY);
    doc.text(`Reviewed by: ${signoff ? signoff.reviewed_by : 'Not signed'}`, startX + 300, currentY);

    doc.end();
});

// --- RISK ASSESSMENT ENDPOINTS ---
app.get('/api/risks', async (req, res) => {
    const { data, error } = await supabase.from('risk_assessment').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message }); res.json(data || []);
});

app.post('/api/risks', async (req, res) => {
    const { data, error } = await supabase.from('risk_assessment').insert([req.body]).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

app.delete('/api/risks/:id', async (req, res) => {
    const { error } = await supabase.from('risk_assessment').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message }); res.json({ success: true });
});

app.get('/api/risk-signoff', async (req, res) => {
    const { data, error } = await supabase.from('risk_signoff').select('*').order('created_at', { ascending: false }).limit(1).single();
    res.json(data || null);
});

app.post('/api/risk-signoff', async (req, res) => {
    const { reviewed_by, review_date } = req.body;
    const { data, error } = await supabase.from('risk_signoff').insert([{ reviewed_by, review_date }]).select().single();
    if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

// Full Risk Assessment PDF Export (Landscape)
app.get('/api/export-risk-pdf', async (req, res) => {
    const { data: risks } = await supabase.from('risk_assessment').select('*').order('id', { ascending: true });
    const { data: signoff } = await supabase.from('risk_signoff').select('*').order('created_at', { ascending: false }).limit(1).single();

    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=StreetFeast_Risk_Assessment.pdf');
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('Risk Assessment Template - Street Feast', { align: 'left' });
    doc.moveDown(1.5);

    const startX = 30;
    let currentY = doc.y;
    
    // Draw Headers
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Task or Issue/Hazard', startX, currentY, { width: 120 });
    doc.text('Person affected & Location', startX + 130, currentY, { width: 120 });
    doc.text('Risk Rating', startX + 260, currentY, { width: 70 });
    doc.text('Risk Control Measures', startX + 340, currentY, { width: 180 });
    doc.text('By Who & When', startX + 530, currentY, { width: 100 });
    doc.text('Notes/Controls', startX + 640, currentY, { width: 150 });
    
    currentY += 25;
    doc.moveTo(startX, currentY).lineTo(810, currentY).stroke('#00a896');
    currentY += 15;

    // Draw Rows
    doc.font('Helvetica');
    if(risks) {
        risks.forEach(risk => {
            const rowHeight = Math.max(
                doc.heightOfString(risk.hazard, { width: 120 }),
                doc.heightOfString(risk.control_measures, { width: 180 })
            );

            doc.text(risk.hazard, startX, currentY, { width: 120 });
            doc.text(risk.person_affected, startX + 130, currentY, { width: 120 });
            doc.text(risk.risk_rating, startX + 260, currentY, { width: 70 });
            doc.text(risk.control_measures, startX + 340, currentY, { width: 180 });
            doc.text(signoff ? `${signoff.reviewed_by}\n${signoff.review_date}` : 'Not signed', startX + 530, currentY, { width: 100 });
            doc.text(risk.notes || '', startX + 640, currentY, { width: 150 });
            
            currentY += rowHeight + 15;
            doc.moveTo(startX, currentY).lineTo(810, currentY).stroke('#dddddd');
            currentY += 15;

            if (currentY > 480) { doc.addPage(); currentY = 40; }
        });
    }

    doc.end();
});

app.listen(PORT, () => {
    console.log(`SFBB Compliance app running on port ${PORT}`);
});
