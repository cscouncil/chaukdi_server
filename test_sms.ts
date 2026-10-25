const apiKey = 'KJwZDEdZQwEbA9sRqVYmQ0nmLEYP0xi6O4AoMZweaOvxoO3M29wBck39iSURibNCtS3i6MZqbLvgXi1s';

async function testQuick() {
  try {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route: 'q',
        message: 'Your Chaukdi verification code is 458921. Valid for 10 mins. - Sovereign Bharat',
        language: 'english',
        flash: 0,
        numbers: '8171893665'
      })
    });
    const data = await res.json();
    console.log('Route Q Status:', res.status, JSON.stringify(data));
  } catch (err: any) {
    console.error('Error in route Q:', err.message);
  }
}

testQuick();
